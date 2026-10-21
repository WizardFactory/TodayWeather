//! Ordered legacy documents as the legacy savers store them through Mongoose 5.1.2 and read them
//! back with `lean()`. Field order follows the MongoDB < 5.0 update rules the savers rely on
//! (existing fields keep their position, new fields are appended in update order); Dates are
//! `{"$date": ms}` like every `KmaStore` answer. Key order never reaches a response (the readers
//! project fixed fields) but answers keep it, as the S15 store contract requires.
use crate::gateway::OrderedJson;
use std::sync::atomic::{AtomicUsize, Ordering};

/// The scalar parseInt semantics used by bounded grid/RSS builders, without allocating a
/// bit vector proportional to an untrusted hexadecimal string. Significant hex values beyond
/// 256 digits overflow f64; at most1024 bits enter the existing exact-rounding helper.
pub(super) fn bounded_int(s: &str) -> Result<f64, crate::storage::Error> {
    let text = s.trim_start_matches(crate::world::js::is_js_space);
    let (sign, rest) = match text.as_bytes().first() {
        Some(b'-') => (-1., &text[1..]),
        Some(b'+') => (1., &text[1..]),
        _ => (1., text),
    };
    if let Some(rest) = rest.strip_prefix("0x").or_else(|| rest.strip_prefix("0X")) {
        let count = rest.chars().take_while(char::is_ascii_hexdigit).count();
        if count == 0 {
            return Ok(f64::NAN);
        }
        let digits = &rest[..count];
        let significant = digits.trim_start_matches('0');
        if significant.len() > 256 {
            return Ok(sign * f64::INFINITY);
        }
        let mut values = Vec::new();
        super::forecast_cache::reserve(&mut values, significant.len())?;
        for c in significant.chars() {
            values.push(c.to_digit(16).expect("checked digit"));
        }
        return Ok(sign * crate::world::js::pow2_radix_value(&values, 4));
    }
    let end = rest.bytes().take_while(u8::is_ascii_digit).count();
    Ok(if end == 0 {
        f64::NAN
    } else {
        sign * rest[..end].parse::<f64>().unwrap_or(f64::NAN)
    })
}

/// One stored value.
#[derive(Debug, Clone, PartialEq)]
pub enum Val {
    Num(f64),
    Str(String),
    Bool(bool),
    Null,
    /// A property set to `undefined` (kept in memory, omitted by `JSON.stringify`).
    Undef,
    Date(f64),
    Arr(Vec<Val>),
    Doc(Doc),
}
impl Val {
    pub(super) fn checked_str(s: &str) -> Result<Self, crate::storage::Error> {
        use super::forecast_cache::add;
        let mut length = 0usize;
        for c in s.chars() {
            length = add(
                length,
                if c as u32 >= 0x10F800 {
                    8
                } else {
                    c.len_utf8()
                },
            )?;
        }
        let mut out = String::new();
        out.try_reserve_exact(length)
            .map_err(|_| crate::storage::Error::Capacity)?;
        for c in s.chars() {
            if c as u32 >= 0x10F800 {
                let mut units = [0u16; 2];
                for unit in c.encode_utf16(&mut units) {
                    out.push(
                        char::from_u32(0x10F800 + u32::from(*unit) - 0xD800)
                            .expect("surrogate stand-in"),
                    );
                }
            } else {
                out.push(c);
            }
        }
        Ok(Self::Str(out))
    }
    /// A number as BSON round-trips it: an integral value in the int32 range loses `-0`.
    pub fn num(n: f64) -> Self {
        if n == 0. { Self::Num(0.) } else { Self::Num(n) }
    }
    /// A string that is already in the value layer's form (taken from another `Val` or a
    /// [`super::super::js::V`]): kept as it is, never canonicalized again.
    pub fn canonical(s: impl Into<String>) -> Self {
        Self::Str(s.into())
    }
    /// A string from outside the value layer (provider or repository text) in the value layer's
    /// form ([`crate::domestic::kma::js::canon_str`]: a character in the stand-in range is kept as
    /// the stand-ins of its surrogates). Strings already in that form use [`Self::canonical`].
    pub fn str(s: impl Into<String>) -> Self {
        let s = s.into();
        if s.as_bytes().contains(&0xF4) {
            Self::Str(crate::domestic::kma::js::canon_str(&s))
        } else {
            Self::Str(s)
        }
    }
    pub fn as_num(&self) -> Option<f64> {
        match self {
            Self::Num(n) => Some(*n),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_doc(&self) -> Option<&Doc> {
        match self {
            Self::Doc(d) => Some(d),
            _ => None,
        }
    }
    pub fn json(&self) -> OrderedJson {
        match self {
            Self::Num(n) => OrderedJson::Number(*n),
            Self::Str(s) => OrderedJson::String(crate::domestic::kma::js::units(s)),
            Self::Bool(b) => OrderedJson::Bool(*b),
            Self::Null => OrderedJson::Null,
            Self::Undef => OrderedJson::Object(vec![(
                "$undefined".encode_utf16().collect(),
                OrderedJson::Bool(true),
            )]),
            Self::Date(ms) => OrderedJson::Object(vec![(
                "$date".encode_utf16().collect(),
                OrderedJson::Number(*ms),
            )]),
            Self::Arr(a) => OrderedJson::Array(a.iter().map(Val::json).collect()),
            Self::Doc(d) => d.json(),
        }
    }
}
impl From<Doc> for Val {
    fn from(d: Doc) -> Self {
        Self::Doc(d)
    }
}

#[cfg(test)]
thread_local! {
    /// Docs whose fields `heap_weight` walked on this thread (tests only).
    static WALKS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// The backing allocations of one stored value (a Doc's cached weight is reused).
fn value_weight(v: &Val) -> Result<usize, crate::storage::Error> {
    use super::forecast_cache::{add, vector};
    Ok(match v {
        Val::Str(s) => super::forecast_cache::allocation(s.capacity())?,
        Val::Doc(d) => d.heap_weight()?,
        Val::Arr(a) => {
            let mut n = vector(a)?;
            for v in a {
                n = add(n, value_weight(v)?)?;
            }
            n
        }
        _ => 0,
    })
}
/// The exact `heap_weight` of a Doc once known; 0 is unknown (a real weight is at least 64).
/// A clone owns other capacities, so it starts unknown; the cache never affects equality.
/// Retained views share their Docs across threads, hence the atomic.
#[derive(Default)]
struct Weight(AtomicUsize);
impl Clone for Weight {
    fn clone(&self) -> Self {
        Self::default()
    }
}
impl PartialEq for Weight {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}

/// An insertion-ordered document.
#[derive(Clone, Default, PartialEq)]
pub struct Doc(Vec<(String, Val)>, Weight);
impl std::fmt::Debug for Doc {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_tuple("Doc").field(&self.0).finish()
    }
}
impl Doc {
    /// Fallible cache-path copy; callers own an admitted parse/fold workspace.
    pub(super) fn checked_clone(&self) -> Result<Self, crate::storage::Error> {
        let mut out = Self::new();
        for (k, v) in &self.0 {
            out.try_set(k, v)?;
        }
        Ok(out)
    }
    pub(super) fn try_set(&mut self, k: &str, v: &Val) -> Result<(), crate::storage::Error> {
        use super::forecast_cache::{add, allocation, copied, reserve};
        use crate::storage::Error;
        fn clone_val(v: &Val, depth: usize) -> Result<Val, Error> {
            if depth > 32 {
                return Err(Error::Capacity);
            }
            Ok(match v {
                Val::Str(s) => Val::Str(copied(s)?),
                Val::Doc(d) => Val::Doc(d.checked_clone()?),
                Val::Arr(a) => {
                    let mut out = Vec::new();
                    reserve(&mut out, a.len())?;
                    for v in a {
                        out.push(clone_val(v, depth + 1)?);
                    }
                    Val::Arr(out)
                }
                other => other.clone(),
            })
        }
        let is_new = !self.has(k);
        if is_new && self.0.len() >= 32 {
            return Err(Error::Capacity);
        }
        // Admit the resulting retained Doc before copying. The caller's workspace covers
        // the temporary old/replacement coexistence; it is not part of the retained Doc cap.
        let extra = match v {
            Val::Str(s) => allocation(s.capacity())?,
            Val::Doc(d) => d.heap_weight()?,
            Val::Arr(_) => return Err(Error::Capacity),
            _ => 0,
        };
        let old = match self.get(k) {
            Some(Val::Str(s)) => allocation(s.capacity())?,
            Some(Val::Doc(d)) => d.heap_weight()?,
            _ => 0,
        };
        let before = super::forecast_cache::vector(&self.0)?;
        let root = allocation(
            self.0
                .capacity()
                .max(self.0.len() + usize::from(is_new))
                .checked_mul(std::mem::size_of::<(String, Val)>())
                .ok_or(Error::Capacity)?,
        )?;
        let current = self.heap_weight()?;
        let projected = add(
            add(current - old, extra)?,
            add(root - before, if is_new { allocation(k.len())? } else { 0 })?,
        )?;
        if projected > 8 * 1024 * 1024 {
            return Err(Error::Capacity);
        }
        let value = clone_val(v, 0)?;
        let stored = value_weight(&value)?;
        // From the first mutation until the exact delta is stored, the weight is unknown: a
        // failed push can leave a grown capacity behind.
        *self.1.0.get_mut() = 0;
        let weight = if let Some((_, slot)) = self.0.iter_mut().find(|(key, _)| key == k) {
            let replaced = value_weight(slot)?;
            *slot = value;
            add(current - replaced, stored)?
        } else {
            reserve(&mut self.0, 1)?;
            self.0.push((copied(k)?, value));
            let key = allocation(self.0.last().map_or(0, |(key, _)| key.capacity()))?;
            add(
                add(current, stored)?,
                add(key, super::forecast_cache::vector(&self.0)? - before)?,
            )?
        };
        *self.1.0.get_mut() = weight;
        Ok(())
    }
    /// Backing allocations only: the containing Vec/Val already charges inline headers. Known
    /// after the first walk or an exact `try_set`, until an unchecked change.
    pub(super) fn heap_weight(&self) -> Result<usize, crate::storage::Error> {
        use super::forecast_cache::{add, allocation, vector};
        let known = self.1.0.load(Ordering::Relaxed);
        if known != 0 {
            return Ok(known);
        }
        #[cfg(test)]
        WALKS.with(|w| w.set(w.get() + 1));
        let mut n = vector(&self.0)?;
        for (k, v) in &self.0 {
            n = add(n, add(allocation(k.capacity())?, value_weight(v)?)?)?;
        }
        self.1.0.store(n, Ordering::Relaxed);
        Ok(n)
    }
    pub fn new() -> Self {
        Self::default()
    }
    pub fn with(mut self, k: &str, v: Val) -> Self {
        self.set(k, v);
        self
    }
    pub fn get(&self, k: &str) -> Option<&Val> {
        self.0.iter().find(|(key, _)| key == k).map(|(_, v)| v)
    }
    pub fn has(&self, k: &str) -> bool {
        self.get(k).is_some()
    }
    /// `$set` of one field: replaced in place, or appended.
    pub fn set(&mut self, k: &str, v: Val) {
        *self.1.0.get_mut() = 0;
        match self.0.iter_mut().find(|(key, _)| key == k) {
            Some((_, slot)) => *slot = v,
            None => self.0.push((k.to_owned(), v)),
        }
    }
    /// `$unset` / `delete`.
    pub fn remove(&mut self, k: &str) {
        *self.1.0.get_mut() = 0;
        self.0.retain(|(key, _)| key != k);
    }
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.0.iter().map(|(k, _)| k.as_str())
    }
    pub fn entries(&self) -> &[(String, Val)] {
        &self.0
    }
    pub fn json(&self) -> OrderedJson {
        OrderedJson::Object(
            self.0
                .iter()
                .map(|(k, v)| (crate::domestic::kma::js::units(k), v.json()))
                .collect(),
        )
    }
}

/// An organizer row: own properties in assignment order over a template prototype
/// (`Object.create(template)`). Mongoose clones it with `for...in`, so the stored form is the
/// own properties followed by the template fields they do not shadow.
#[derive(Debug, Clone)]
pub struct Row {
    template: &'static [(&'static str, Tmpl)],
    own: Doc,
}
/// A template default.
#[derive(Debug, Clone, Copy)]
pub enum Tmpl {
    Num(f64),
    Str(&'static str),
}
impl Tmpl {
    fn val(self) -> Val {
        match self {
            Self::Num(n) => Val::Num(n),
            Self::Str(s) => Val::str(s),
        }
    }
}
impl Row {
    pub(super) fn bounded(
        template: &'static [(&'static str, Tmpl)],
    ) -> Result<Self, crate::storage::Error> {
        let mut fields = Vec::new();
        super::forecast_cache::reserve(&mut fields, 32)?;
        Ok(Self {
            template,
            own: Doc(fields, Weight::default()),
        })
    }
    pub(super) fn heap_weight(&self) -> Result<usize, crate::storage::Error> {
        self.own.heap_weight()
    }
    pub(super) fn try_set(&mut self, k: &str, v: &Val) -> Result<(), crate::storage::Error> {
        self.own.try_set(k, v)
    }
    pub(super) fn checked_materialized(&self) -> Result<Doc, crate::storage::Error> {
        let mut out = self.own.checked_clone()?;
        for (k, v) in self.template {
            if !out.has(k) {
                out.try_set(k, &v.val())?;
            }
        }
        Ok(out)
    }
    pub fn new(template: &'static [(&'static str, Tmpl)]) -> Self {
        Self {
            template,
            own: Doc::new(),
        }
    }
    /// Property read through the prototype chain.
    pub fn get(&self, k: &str) -> Option<Val> {
        self.own.get(k).cloned().or_else(|| {
            self.template
                .iter()
                .find(|(name, _)| *name == k)
                .map(|(_, v)| v.val())
        })
    }
    pub fn num(&self, k: &str) -> f64 {
        self.get(k).and_then(|v| v.as_num()).unwrap_or(f64::NAN)
    }
    pub fn text(&self, k: &str) -> String {
        match self.get(k) {
            Some(Val::Str(s)) => s,
            _ => String::new(),
        }
    }
    pub fn set(&mut self, k: &str, v: Val) {
        self.own.set(k, v);
    }
    /// `delete row[k]` (the template value shows through again).
    pub fn delete(&mut self, k: &str) {
        self.own.remove(k);
    }
    pub fn has_own(&self, k: &str) -> bool {
        self.own.has(k)
    }
    pub fn own(&self) -> &Doc {
        &self.own
    }
    /// `for (k in row)` order: own keys, then unshadowed template keys.
    pub fn materialized(&self) -> Doc {
        let mut out = self.own.clone();
        for (k, v) in self.template {
            if !out.has(k) {
                out.set(k, v.val());
            }
        }
        out
    }
}

/// `utils.clone` + Mongoose `strict` cast of a nested path: fields outside `schema` are dropped,
/// numbers round-trip through BSON.
pub fn strict(doc: &Doc, schema: &[&str]) -> Doc {
    let mut out = Doc::new();
    for (k, v) in doc.entries() {
        if schema.contains(&k.as_str()) {
            out.set(
                k,
                match v {
                    Val::Num(n) => Val::num(*n),
                    other => other.clone(),
                },
            );
        }
    }
    out
}
pub(super) fn checked_strict(doc: &Doc, schema: &[&str]) -> Result<Doc, crate::storage::Error> {
    let mut out = Doc::new();
    for (k, v) in doc.entries() {
        if schema.contains(&k.as_str()) {
            match v {
                Val::Num(n) => out.try_set(k, &Val::num(*n))?,
                other => out.try_set(k, other)?,
            }
        }
    }
    Ok(out)
}
/// Admit the retained collection's exact descendant weights before committing a replacement
/// or growing its root vector. Temporary construction remains workspace-owned.
pub(super) fn checked_store(
    docs: &mut Vec<Doc>,
    index: Option<usize>,
    doc: Doc,
) -> Result<(), crate::storage::Error> {
    checked_store_with_limit(docs, index, doc, 8 * 1024 * 1024)
}
fn checked_store_with_limit(
    docs: &mut Vec<Doc>,
    index: Option<usize>,
    doc: Doc,
    limit: usize,
) -> Result<(), crate::storage::Error> {
    use super::forecast_cache::{add, allocation, reserve};
    let n = docs.len() + usize::from(index.is_none());
    if n > super::forecast_cache::DOCS {
        return Err(crate::storage::Error::Capacity);
    }
    let capacity = docs.capacity().max(n);
    let mut weight = allocation(
        capacity
            .checked_mul(std::mem::size_of::<Doc>())
            .ok_or(crate::storage::Error::Capacity)?,
    )?;
    for (i, d) in docs.iter().enumerate() {
        if Some(i) != index {
            weight = add(weight, d.heap_weight()?)?;
        }
    }
    weight = add(weight, doc.heap_weight()?)?;
    if weight > limit {
        return Err(crate::storage::Error::Capacity);
    }
    if let Some(i) = index {
        docs[i] = doc;
    } else {
        reserve(docs, 1)?;
        docs.push(doc);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonical_doc32_fields_fit_and33_is_refused_before_growth() {
        let mut doc = Doc::new();
        for n in 0..32 {
            doc.try_set(&format!("field{n}"), &Val::Num(n as f64))
                .unwrap();
        }
        assert_eq!(doc.entries().len(), 32);
        let capacity = doc.0.capacity();
        let before = doc.clone();
        assert!(matches!(
            doc.try_set("field32", &Val::Num(32.)),
            Err(crate::storage::Error::Capacity)
        ));
        assert_eq!(doc, before);
        assert_eq!(doc.0.capacity(), capacity);
        doc.try_set("field0", &Val::Num(42.)).unwrap();
        assert_eq!(doc.entries().len(), 32);
        assert_eq!(doc.get("field0"), Some(&Val::Num(42.)));
    }
    #[test]
    fn strings_are_canonicalized_once_at_ingress() {
        let real = "\u{10F800}x";
        let ingress = Val::str(real);
        assert_eq!(
            ingress.json(),
            OrderedJson::String(real.encode_utf16().collect())
        );
        let Val::Str(internal) = &ingress else {
            panic!("{ingress:?}")
        };
        // Reusing an internal string keeps it; canonicalizing it again would expand it twice.
        assert_eq!(Val::canonical(internal.as_str()), ingress);
        assert_ne!(Val::str(internal.as_str()), ingress);
        assert_eq!(Val::checked_str(real).unwrap(), ingress);
    }
    #[test]
    fn retained_doc_limit_is_checked_before_root_growth_at_exact_boundaries() {
        let doc = Doc::new().with("s", Val::str("x")).checked_clone().unwrap();
        let limit = super::super::forecast_cache::allocation(std::mem::size_of::<Doc>()).unwrap()
            + doc.heap_weight().unwrap();
        let mut below = Vec::new();
        assert!(matches!(
            checked_store_with_limit(&mut below, None, doc.clone(), limit - 1),
            Err(crate::storage::Error::Capacity)
        ));
        assert_eq!(below.capacity(), 0);
        let mut at = Vec::new();
        checked_store_with_limit(&mut at, None, doc.clone(), limit).unwrap();
        assert_eq!(at.len(), 1);
        let mut above = Vec::new();
        checked_store_with_limit(&mut above, None, doc, limit + 1).unwrap();
        assert_eq!(above.len(), 1);
    }
    #[test]
    fn bounded_integer_matches_scalar_compatibility_without_unbounded_hex_vectors() {
        use crate::domestic::kma::js::{V, parse_int};
        for s in [
            "60",
            "  -0",
            "+127x",
            "0x1fffffffffffff",
            "0x20000000000001",
            "0Xffff",
            "0x",
            "not-number",
        ] {
            let (a, b) = (bounded_int(s).unwrap(), parse_int(&V::s(s)));
            assert!(a == b || (a.is_nan() && b.is_nan()), "{s}: {a} vs{b}");
            assert_eq!(a.is_sign_negative(), b.is_sign_negative(), "{s}");
        }
        assert_eq!(
            bounded_int(&format!("0x{}f", "0".repeat(256 * 1024))).unwrap(),
            15.
        );
        assert_eq!(
            bounded_int(&format!("0x{}", "f".repeat(256 * 1024))).unwrap(),
            f64::INFINITY
        );
    }
    struct Rng(u64);
    impl Rng {
        fn next(&mut self, bound: u64) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0 % bound
        }
    }
    /// Any value, with varied string capacities, nested Docs and (rejected by `try_set`) arrays.
    fn any_value(rng: &mut Rng, depth: usize) -> Val {
        match rng.next(if depth < 2 { 7 } else { 5 }) {
            0 => Val::Num(rng.next(1000) as f64),
            1 => {
                let mut s = String::with_capacity(rng.next(200) as usize);
                for _ in 0..rng.next(40) {
                    s.push('x');
                }
                Val::Str(s)
            }
            2 => Val::Date(rng.next(1_000_000) as f64),
            3 => Val::Null,
            4 => Val::Bool(rng.next(2) == 0),
            5 => {
                let mut d = Doc::new();
                for i in 0..rng.next(5) {
                    d.set(&format!("n{i}"), any_value(rng, depth + 1));
                }
                Val::Doc(d)
            }
            _ => Val::Arr(
                (0..rng.next(4))
                    .map(|_| any_value(rng, depth + 1))
                    .collect(),
            ),
        }
    }
    /// An independent full walk of the backing allocations: the oracle of every Doc weight.
    fn fresh(doc: &Doc) -> usize {
        use super::super::forecast_cache::{allocation, vector};
        fn value(v: &Val) -> usize {
            match v {
                Val::Str(s) => allocation(s.capacity()).unwrap(),
                Val::Doc(d) => fresh(d),
                Val::Arr(a) => vector(a).unwrap() + a.iter().map(value).sum::<usize>(),
                _ => 0,
            }
        }
        vector(&doc.0).unwrap()
            + doc
                .0
                .iter()
                .map(|(k, v)| allocation(k.capacity()).unwrap() + value(v))
                .sum::<usize>()
    }
    #[test]
    fn doc_weights_equal_a_full_walk_after_every_change() {
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        for _ in 0..300 {
            let mut doc = Doc::new();
            for _ in 0..60 {
                let key = format!("k{}", rng.next(40));
                match rng.next(7) {
                    // Refused sets (arrays, a 33rd field) must leave a correct weight too.
                    0..=2 => {
                        let _ = doc.try_set(&key, &any_value(&mut rng, 0));
                    }
                    3 => doc.set(&key, any_value(&mut rng, 0)),
                    4 => doc.remove(&key),
                    5 => doc = doc.clone(),
                    _ => doc = doc.checked_clone().unwrap_or_else(|_| doc.clone()),
                }
                assert_eq!(doc.heap_weight().unwrap(), fresh(&doc));
            }
        }
    }
    #[test]
    fn collection_admission_equals_a_full_recomputation_at_every_limit() {
        use super::super::forecast_cache::allocation;
        fn scalar(rng: &mut Rng) -> Val {
            loop {
                let v = any_value(rng, 1);
                if !matches!(v, Val::Arr(_)) {
                    break v;
                }
            }
        }
        let mut rng = Rng(0x2545_F491_4F6C_DD1D);
        for _ in 0..300 {
            let mut docs = Vec::new();
            for _ in 0..rng.next(12) {
                let mut d = Doc::new();
                for i in 0..rng.next(6) {
                    d.try_set(&format!("f{i}"), &scalar(&mut rng)).unwrap();
                }
                docs.push(d);
            }
            let mut doc = Doc::new();
            for i in 0..rng.next(6) {
                doc.try_set(&format!("g{i}"), &scalar(&mut rng)).unwrap();
            }
            let index = (!docs.is_empty() && rng.next(2) == 0)
                .then(|| rng.next(docs.len() as u64) as usize);
            for (delta, admitted) in [(-1_isize, false), (0, true), (1, true)] {
                let mut target = docs.clone();
                let n = target.len() + usize::from(index.is_none());
                let exact = allocation(target.capacity().max(n) * std::mem::size_of::<Doc>())
                    .unwrap()
                    + target
                        .iter()
                        .enumerate()
                        .filter(|(i, _)| Some(*i) != index)
                        .map(|(_, d)| fresh(d))
                        .sum::<usize>()
                    + fresh(&doc);
                let before = target.clone();
                let result = checked_store_with_limit(
                    &mut target,
                    index,
                    doc.clone(),
                    exact.saturating_add_signed(delta),
                );
                assert_eq!(result.is_ok(), admitted, "limit {delta:+} of {exact}");
                if !admitted {
                    assert_eq!(target, before);
                } else if let Some(i) = index {
                    assert_eq!(target[i], doc);
                } else {
                    assert_eq!(target.last(), Some(&doc));
                }
            }
        }
    }
    #[test]
    fn stores_and_field_sets_walk_each_doc_a_bounded_number_of_times() {
        fn walks() -> usize {
            WALKS.with(std::cell::Cell::get)
        }
        fn store(n: usize) -> usize {
            let start = walks();
            let mut docs = Vec::new();
            for i in 0..n {
                let coord = Doc::new()
                    .with("mx", Val::Num(60.))
                    .with("my", Val::Num(127.));
                let mut d = Doc::new();
                d.try_set("mCoord", &Val::Doc(coord)).unwrap();
                d.try_set("fcsDate", &Val::Date(i as f64)).unwrap();
                d.try_set("data", &Val::str(format!("value {i}"))).unwrap();
                checked_store(&mut docs, None, d).unwrap();
            }
            walks() - start
        }
        let (small, large) = (store(64), store(256));
        assert!(
            large <= 8 * 256,
            "storing 256 Docs walked {large} Docs (64 Docs: {small})"
        );
        let start = walks();
        let mut wide = Doc::new();
        for i in 0..32 {
            wide.try_set(&format!("f{i}"), &Val::Num(i as f64)).unwrap();
        }
        let sets = walks() - start;
        eprintln!("Doc walks: 64 stores {small}, 256 stores {large}, 32 field sets {sets}");
        assert!(sets <= 2, "32 field sets walked the Doc {sets} times");
    }
}
