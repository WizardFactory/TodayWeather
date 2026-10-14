//! Ordered legacy documents as the legacy savers store them through Mongoose 5.1.2 and read them
//! back with `lean()`. Field order follows the MongoDB < 5.0 update rules the savers rely on
//! (existing fields keep their position, new fields are appended in update order); Dates are
//! `{"$date": ms}` like every `KmaStore` answer. Key order never reaches a response (the readers
//! project fixed fields) but answers keep it, as the S15 store contract requires.
use crate::gateway::OrderedJson;

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
    /// A number as BSON round-trips it: an integral value in the int32 range loses `-0`.
    pub fn num(n: f64) -> Self {
        if n == 0. { Self::Num(0.) } else { Self::Num(n) }
    }
    pub fn str(s: impl Into<String>) -> Self {
        Self::Str(s.into())
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
            Self::Str(s) => OrderedJson::String(s.encode_utf16().collect()),
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

/// An insertion-ordered document.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Doc(Vec<(String, Val)>);
impl Doc {
    pub fn new() -> Self {
        Self(Vec::new())
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
        match self.0.iter_mut().find(|(key, _)| key == k) {
            Some((_, slot)) => *slot = v,
            None => self.0.push((k.to_owned(), v)),
        }
    }
    /// `$unset` / `delete`.
    pub fn remove(&mut self, k: &str) {
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
                .map(|(k, v)| (k.encode_utf16().collect(), v.json()))
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
