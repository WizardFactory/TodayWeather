//! S15b-2 restart read: the station page product of one KST day (AK 2026-11-07, "A로 진행").
//!
//! A restarted process restored every stored AWS hourly and city page of the 8-day window and
//! parsed each again (about 1 s per day on a t3.small) before its first answer had past days. The
//! product holds the parsed inputs of the hourly fold (not its output) for the pages of one day:
//! per page kind and hour the newest page, as the process keeps it, with its fetch instant, raw
//! digest and canonical raw identity. AWS rows of stations outside the city set are kept as their
//! registry facts (the reduced form the fold keeps them in), each distinct facts document once.
//!
//! A product is never the truth: a reader compares it with the day catalogs and restores what it
//! lacks. `cityIds` is the city set its reduced rows keep in full. Every listed group of the day is
//! accounted for (S16 completeness): its pages, `knownIds` (the other groups found complete) and
//! `excludedIds` (a member of each group S06 excluded, `excluded` of them); a reader checks the
//! excluded and the unaccounted groups again. Values keep every [`Val`] (undefined, dates, negative
//! zero and NaN) through a tagged string form.
use super::doc::{Doc, Val};
use crate::domestic::publication::Publication;
use serde::de::{self, Deserializer, MapAccess, SeqAccess, Visitor};
use serde::ser::{SerializeMap, SerializeSeq, Serializer};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

/// Kind of the product (source `kma-web`, the AWS page key, partition `YYYYMMDD`).
pub const KIND: &str = "station-pages";
/// The product's layout.
pub const SCHEMA: u64 = 2;
/// Bumped whenever page parsing (`parse_aws`, `parse_city`) or the reduction to registry facts
/// changes: an older product is then read as absent.
pub const PARSE_REVISION: u64 = 1;
/// The largest product JSON a reader expands.
pub const JSON_BYTES: u64 = 16 << 20;
/// Marks a tagged value in a string (a stored string starting with it is escaped).
const TAG: char = '\u{1}';
/// The kinds of pages a product holds.
pub const PAGE_KINDS: [&str; 2] = ["aws-hourly", "city-obs"];

/// One stored page of a day.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredPage {
    pub kind: &'static str,
    pub hour: Publication,
    pub fetched_at_ms: f64,
    pub sha256: String,
    pub raw_id: String,
    pub rows: Arc<Vec<Doc>>,
}
/// The pages of one KST day.
#[derive(Debug, Clone, PartialEq)]
pub struct DayProduct {
    pub made: f64,
    pub day: u32,
    /// Raw identities of the other listed groups found complete.
    pub known: BTreeSet<String>,
    /// Raw identities of a member of each listed group S06 excluded.
    pub excluded: BTreeSet<String>,
    pub city_ids: BTreeSet<String>,
    pub pages: Vec<StoredPage>,
}
/// What a product is made of: its pages, city set, excluded groups and parse revision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MadeOf {
    pages: Vec<String>,
    city_ids: Vec<String>,
    excluded: Vec<String>,
    revision: u64,
}
impl MadeOf {
    pub fn new<'a>(
        raw_ids: impl Iterator<Item = &'a str>,
        city_ids: &BTreeSet<String>,
        excluded: &BTreeSet<String>,
    ) -> Self {
        let mut pages: Vec<String> = raw_ids.map(str::to_owned).collect();
        pages.sort();
        Self {
            pages,
            city_ids: city_ids.iter().cloned().collect(),
            excluded: excluded.iter().cloned().collect(),
            revision: PARSE_REVISION,
        }
    }
}

impl DayProduct {
    pub fn made_of(&self) -> MadeOf {
        MadeOf::new(
            self.pages.iter().map(|p| p.raw_id.as_str()),
            &self.city_ids,
            &self.excluded,
        )
    }
    /// The stored form: gzip of the product JSON. An AWS row equal to its registry facts
    /// (`facts`) is stored as an index into the facts table.
    pub fn encode(&self, facts: impl Fn(&Doc) -> Doc) -> std::io::Result<Vec<u8>> {
        use std::io::Write;
        let mut table: Vec<&Doc> = Vec::new();
        let mut index: HashMap<Vec<u8>, usize> = HashMap::new();
        let mut pages = Vec::with_capacity(self.pages.len());
        for page in &self.pages {
            let mut rows = Vec::with_capacity(page.rows.len());
            for row in page.rows.iter() {
                if page.kind == "aws-hourly" && facts(row) == *row {
                    let key = serde_json::to_vec(&V(&Val::Doc(row.clone())))?;
                    let at = *index.entry(key).or_insert_with(|| {
                        table.push(row);
                        table.len() - 1
                    });
                    rows.push(RowOut::Fact(at));
                } else {
                    rows.push(RowOut::Full(row));
                }
            }
            pages.push(PageOut {
                kind: page.kind,
                hour: page.hour.time(),
                fetched_at: page.fetched_at_ms,
                sha256: &page.sha256,
                raw_id: &page.raw_id,
                rows,
            });
        }
        let out = ProductOut {
            schema: SCHEMA,
            parse_revision: PARSE_REVISION,
            made: self.made,
            day: self.day,
            excluded: self.excluded.len(),
            known_ids: &self.known,
            excluded_ids: &self.excluded,
            city_ids: &self.city_ids,
            facts: table.into_iter().map(DocOut).collect(),
            pages,
        };
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        serde_json::to_writer(&mut gzip, &out)?;
        gzip.flush()?;
        gzip.finish()
    }
    /// A stored product of `day`; None when it is not one of this schema and parse revision, or
    /// expands past [`JSON_BYTES`].
    pub fn decode(stored: &[u8], day: u32) -> Option<Self> {
        use std::io::Read;
        let mut bytes = Vec::new();
        flate2::read::GzDecoder::new(stored)
            .take(JSON_BYTES + 1)
            .read_to_end(&mut bytes)
            .ok()?;
        if bytes.len() as u64 > JSON_BYTES {
            return None;
        }
        let stored: ProductIn = serde_json::from_slice(&bytes).ok()?;
        if stored.schema != SCHEMA
            || stored.parse_revision != PARSE_REVISION
            || stored.day != day
            || stored.excluded != stored.excluded_ids.len()
        {
            return None;
        }
        let facts: Vec<Doc> = stored
            .facts
            .into_iter()
            .map(|v| match v.0 {
                Val::Doc(d) => Some(d),
                _ => None,
            })
            .collect::<Option<_>>()?;
        let mut seen = BTreeSet::new();
        let mut pages = Vec::with_capacity(stored.pages.len());
        for page in stored.pages {
            let kind = *PAGE_KINDS.iter().find(|k| **k == page.kind)?;
            let hour = Publication::new(day, page.hour).filter(|h| h.minute() == 0)?;
            if !seen.insert((kind, hour)) || !page.fetched_at.is_finite() {
                return None;
            }
            let rows = page
                .rows
                .into_iter()
                .map(|row| match row.0 {
                    Val::Doc(d) => Some(d),
                    Val::Num(n) if kind == "aws-hourly" && n >= 0. && n.fract() == 0. => {
                        facts.get(n as usize).cloned()
                    }
                    _ => None,
                })
                .collect::<Option<Vec<_>>>()?;
            pages.push(StoredPage {
                kind,
                hour,
                fetched_at_ms: page.fetched_at,
                sha256: page.sha256,
                raw_id: page.raw_id,
                rows: Arc::new(rows),
            });
        }
        Some(Self {
            made: stored.made,
            day,
            known: stored.known_ids,
            excluded: stored.excluded_ids,
            city_ids: stored.city_ids,
            pages,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductOut<'a> {
    schema: u64,
    parse_revision: u64,
    made: f64,
    day: u32,
    excluded: usize,
    known_ids: &'a BTreeSet<String>,
    excluded_ids: &'a BTreeSet<String>,
    city_ids: &'a BTreeSet<String>,
    facts: Vec<DocOut<'a>>,
    pages: Vec<PageOut<'a>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PageOut<'a> {
    kind: &'a str,
    hour: u16,
    fetched_at: f64,
    sha256: &'a str,
    raw_id: &'a str,
    rows: Vec<RowOut<'a>>,
}
enum RowOut<'a> {
    Fact(usize),
    Full(&'a Doc),
}
impl Serialize for RowOut<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Fact(i) => s.serialize_u64(*i as u64),
            Self::Full(d) => DocOut(d).serialize(s),
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductIn {
    schema: u64,
    parse_revision: u64,
    made: f64,
    day: u32,
    excluded: usize,
    known_ids: BTreeSet<String>,
    excluded_ids: BTreeSet<String>,
    city_ids: BTreeSet<String>,
    facts: Vec<ValIn>,
    pages: Vec<PageIn>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageIn {
    kind: String,
    hour: u16,
    fetched_at: f64,
    sha256: String,
    raw_id: String,
    rows: Vec<ValIn>,
}

/// A document in key order.
struct DocOut<'a>(&'a Doc);
impl Serialize for DocOut<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut map = s.serialize_map(Some(self.0.entries().len()))?;
        for (k, v) in self.0.entries() {
            map.serialize_entry(k, &V(v))?;
        }
        map.end()
    }
}
/// A value: JSON for numbers, strings, booleans, null, arrays and documents; a tagged string for
/// undefined, dates, non-finite numbers and negative zero; a string starting with the tag gets one
/// more.
struct V<'a>(&'a Val);
impl Serialize for V<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            Val::Num(n) if n.is_finite() && !(*n == 0. && n.is_sign_negative()) => {
                if n.fract() == 0. && n.abs() < 9_007_199_254_740_992. {
                    s.serialize_i64(*n as i64)
                } else {
                    s.serialize_f64(*n)
                }
            }
            Val::Num(n) => s.serialize_str(&format!("{TAG}n{:016x}", n.to_bits())),
            Val::Str(t) if t.starts_with(TAG) => s.serialize_str(&format!("{TAG}{t}")),
            Val::Str(t) => s.serialize_str(t),
            Val::Bool(b) => s.serialize_bool(*b),
            Val::Null => s.serialize_unit(),
            Val::Undef => s.serialize_str(&format!("{TAG}u")),
            Val::Date(ms) => s.serialize_str(&format!("{TAG}d{:016x}", ms.to_bits())),
            Val::Arr(a) => {
                let mut seq = s.serialize_seq(Some(a.len()))?;
                for v in a {
                    seq.serialize_element(&V(v))?;
                }
                seq.end()
            }
            Val::Doc(d) => DocOut(d).serialize(s),
        }
    }
}
fn tagged(t: &str) -> Option<Val> {
    let Some(rest) = t.strip_prefix(TAG) else {
        return Some(Val::Str(t.to_owned()));
    };
    let bits = |hex: &str| {
        (hex.len() == 16)
            .then(|| u64::from_str_radix(hex, 16).ok())
            .flatten()
            .map(f64::from_bits)
    };
    if rest.starts_with(TAG) {
        Some(Val::Str(rest.to_owned()))
    } else if rest == "u" {
        Some(Val::Undef)
    } else if let Some(hex) = rest.strip_prefix('d') {
        bits(hex).map(Val::Date)
    } else if let Some(hex) = rest.strip_prefix('n') {
        bits(hex).map(Val::Num)
    } else {
        None
    }
}
/// A stored value read back ([`V`]'s form).
struct ValIn(Val);
impl<'de> Deserialize<'de> for ValIn {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct Of;
        impl<'de> Visitor<'de> for Of {
            type Value = Val;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a stored value")
            }
            fn visit_bool<E: de::Error>(self, b: bool) -> Result<Val, E> {
                Ok(Val::Bool(b))
            }
            fn visit_i64<E: de::Error>(self, n: i64) -> Result<Val, E> {
                Ok(Val::Num(n as f64))
            }
            fn visit_u64<E: de::Error>(self, n: u64) -> Result<Val, E> {
                Ok(Val::Num(n as f64))
            }
            fn visit_f64<E: de::Error>(self, n: f64) -> Result<Val, E> {
                Ok(Val::Num(n))
            }
            fn visit_str<E: de::Error>(self, t: &str) -> Result<Val, E> {
                tagged(t).ok_or_else(|| E::custom("tagged value"))
            }
            fn visit_unit<E: de::Error>(self) -> Result<Val, E> {
                Ok(Val::Null)
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Val, A::Error> {
                let mut out = Vec::new();
                while let Some(v) = seq.next_element::<ValIn>()? {
                    out.push(v.0);
                }
                Ok(Val::Arr(out))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Val, A::Error> {
                let mut doc = Doc::new();
                while let Some((k, v)) = map.next_entry::<String, ValIn>()? {
                    if doc.has(&k) {
                        return Err(de::Error::custom("repeated key"));
                    }
                    doc.set(&k, v.0);
                }
                Ok(Val::Doc(doc))
            }
        }
        d.deserialize_any(Of).map(ValIn)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn facts(d: &Doc) -> Doc {
        let mut out = Doc::new();
        for k in ["stnId", "stnName"] {
            if let Some(v) = d.get(k) {
                out.set(k, v.clone());
            }
        }
        out
    }
    #[test]
    fn every_value_and_key_order_round_trips() {
        let nested = Doc::new()
            .with("z", Val::Num(1.))
            .with("a", Val::Arr(vec![Val::Null, Val::Bool(false)]));
        let full = Doc::new()
            .with("stnId", Val::Num(108.))
            .with("zeta", Val::Str("서울".into()))
            .with("alpha", Val::Num(-0.))
            .with("nan", Val::Num(f64::NAN))
            .with("inf", Val::Num(f64::NEG_INFINITY))
            .with("big", Val::Num(1e300))
            .with("frac", Val::Num(18.4))
            .with("huge", Val::Num(9_007_199_254_740_993.))
            .with("undef", Val::Undef)
            .with("date", Val::Date(1_790_214_600_000.))
            .with("bad date", Val::Date(f64::NAN))
            .with("tag", Val::Str(format!("{TAG}u")))
            .with("tags", Val::Str(format!("{TAG}{TAG}")))
            .with("doc", Val::Doc(nested))
            .with("null", Val::Null);
        let reduced = Doc::new()
            .with("stnId", Val::Num(400.))
            .with("stnName", Val::Str("강남".into()));
        let product = DayProduct {
            made: 1_790_300_000_000.5,
            day: 20260924,
            known: ["raw/c".to_owned()].into(),
            excluded: ["raw/d".to_owned(), "raw/e".to_owned()].into(),
            city_ids: ["108".to_owned()].into(),
            pages: vec![
                StoredPage {
                    kind: "aws-hourly",
                    hour: Publication::new(20260924, 1000).unwrap(),
                    fetched_at_ms: 1_790_211_900_000.,
                    sha256: "a".repeat(64),
                    raw_id: "raw/a".into(),
                    rows: Arc::new(vec![full.clone(), reduced.clone(), reduced.clone()]),
                },
                StoredPage {
                    kind: "city-obs",
                    hour: Publication::new(20260924, 1000).unwrap(),
                    fetched_at_ms: 1_790_211_900_001.,
                    sha256: "b".repeat(64),
                    raw_id: "raw/b".into(),
                    rows: Arc::new(vec![reduced.clone()]),
                },
            ],
        };
        let bytes = product.encode(facts).unwrap();
        let back = DayProduct::decode(&bytes, 20260924).unwrap();
        assert_eq!(back.made_of(), product.made_of());
        assert_eq!(back.city_ids, product.city_ids);
        assert_eq!(
            (back.made, &back.known, &back.excluded),
            (product.made, &product.known, &product.excluded)
        );
        for (a, b) in back.pages.iter().zip(&product.pages) {
            assert_eq!(
                (a.kind, a.hour, a.fetched_at_ms, &a.sha256, &a.raw_id),
                (b.kind, b.hour, b.fetched_at_ms, &b.sha256, &b.raw_id)
            );
            assert_eq!(a.rows.len(), b.rows.len());
            for (x, y) in a.rows.iter().zip(b.rows.iter()) {
                // NaN is not equal to itself: compare the stored bits.
                assert_eq!(bits(x), bits(y));
            }
        }
        // One facts document for the two reduced AWS rows; the city row stays whole.
        let mut raw = Vec::new();
        std::io::Read::read_to_end(&mut flate2::read::GzDecoder::new(&bytes[..]), &mut raw)
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&raw).unwrap();
        assert_eq!(json["facts"].as_array().unwrap().len(), 1);
        assert_eq!(json["pages"][0]["rows"][1], serde_json::json!(0));
        assert!(json["pages"][1]["rows"][0].is_object());
        // Another day, schema or revision is not this product.
        assert!(DayProduct::decode(&bytes, 20260923).is_none());
        assert!(DayProduct::decode(b"not gzip", 20260924).is_none());
    }
    fn bits(d: &Doc) -> Vec<(String, String)> {
        fn val(v: &Val) -> String {
            match v {
                Val::Num(n) => format!("n{:x}", n.to_bits()),
                Val::Date(n) => format!("d{:x}", n.to_bits()),
                Val::Doc(d) => format!("{:?}", bits(d)),
                Val::Arr(a) => format!("{:?}", a.iter().map(val).collect::<Vec<_>>()),
                other => format!("{other:?}"),
            }
        }
        d.entries()
            .iter()
            .map(|(k, v)| (k.clone(), val(v)))
            .collect()
    }
}
