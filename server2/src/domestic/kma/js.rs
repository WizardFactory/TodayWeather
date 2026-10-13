//! JavaScript value semantics for the v000903 KMA port: shared object references (the legacy
//! controllers alias rows between lists), insertion-ordered properties with array-index keys
//! first, `undefined` kept in memory and dropped by `JSON.stringify`, abstract equality and
//! relational coercion, and exceptions that unwind to the nearest legacy `try`/`catch`.
//!
//! A legacy exception is a `resume_unwind` carrying [`Thrown`]; it does not run the panic hook.
//! [`catch`] stops only that payload and re-raises every other panic, so a Rust bug is never
//! mapped to legacy error handling.
use crate::gateway::{OrderedJson, response::js_number};
use crate::world::js as wjs;
use std::{cell::RefCell, rc::Rc};

/// A legacy exception (TypeError or thrown Error) with its message.
#[derive(Debug, Clone, PartialEq)]
pub struct Thrown(pub String);
/// Raise a legacy exception.
pub fn throw(message: impl Into<String>) -> ! {
    std::panic::resume_unwind(Box::new(Thrown(message.into())))
}
/// Legacy work this port cannot reproduce (a redirect, geocoding a new town, a remote remap).
/// It passes every legacy `catch` and ends the assembly with a forward to legacy.
#[derive(Debug, Clone, PartialEq)]
pub struct Forward(pub String);
pub fn forward(reason: impl Into<String>) -> ! {
    std::panic::resume_unwind(Box::new(Forward(reason.into())))
}
/// Legacy `try { f() } catch (e) { ... }`: Err for a [`Thrown`] exception only.
pub fn catch<T>(f: impl FnOnce() -> T) -> Result<T, Thrown> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(v) => Ok(v),
        Err(payload) => match payload.downcast::<Thrown>() {
            Ok(thrown) => Err(*thrown),
            Err(other) => std::panic::resume_unwind(other),
        },
    }
}

/// Precipitation bounds kept beside a row (`kmaPrecipitation`'s WeakMap); never serialized.
#[derive(Clone, Debug, PartialEq)]
pub struct Total {
    pub amount: f64,
    pub min: f64,
    /// `None` is the legacy `max: null` (no upper bound).
    pub max: Option<f64>,
    pub approx: bool,
    /// `None` is an absent `hours` property (counts as one hour in `total`).
    pub hours: Option<f64>,
}

#[derive(Default, Debug)]
pub struct Props {
    entries: Vec<(String, V)>,
    kept: Vec<(String, Option<Total>)>,
}
#[derive(Clone, Debug)]
pub struct Ob(Rc<RefCell<Props>>);
#[derive(Clone, Debug)]
pub struct Arr(Rc<RefCell<Vec<V>>>);
#[derive(Clone, Debug, Default)]
pub enum V {
    #[default]
    Undef,
    Null,
    Bool(bool),
    Num(f64),
    Str(Rc<str>),
    /// A Date time value in ms (NaN when invalid). Dates are never mutated by the port.
    Date(f64),
    Arr(Arr),
    Obj(Ob),
}

/// Canonical array-index property name (`0 ..= 2^32 - 2`), ordered numerically first.
fn index_key(k: &str) -> Option<u64> {
    if k.is_empty() || k.len() > 10 || (k.len() > 1 && k.starts_with('0')) {
        return None;
    }
    if !k.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    k.parse::<u64>().ok().filter(|n| *n < 4_294_967_295)
}

impl Default for Ob {
    fn default() -> Self {
        Self::new()
    }
}
impl Ob {
    pub fn new() -> Self {
        Self(Rc::new(RefCell::new(Props::default())))
    }
    pub fn get(&self, k: &str) -> V {
        self.0
            .borrow()
            .entries
            .iter()
            .find(|(key, _)| key == k)
            .map_or(V::Undef, |(_, v)| v.clone())
    }
    /// `hasOwnProperty`.
    pub fn has(&self, k: &str) -> bool {
        self.0.borrow().entries.iter().any(|(key, _)| key == k)
    }
    pub fn set(&self, k: &str, v: impl Into<V>) {
        let v = v.into();
        let mut p = self.0.borrow_mut();
        if let Some(slot) = p.entries.iter_mut().find(|(key, _)| key == k) {
            slot.1 = v;
        } else {
            p.entries.push((k.to_owned(), v));
        }
    }
    /// `delete obj[k]`.
    pub fn del(&self, k: &str) {
        self.0.borrow_mut().entries.retain(|(key, _)| key != k);
    }
    /// Own enumerable keys in JavaScript order (array indices ascending, then insertion order).
    pub fn keys(&self) -> Vec<String> {
        let p = self.0.borrow();
        let mut index: Vec<(u64, String)> = p
            .entries
            .iter()
            .filter_map(|(k, _)| index_key(k).map(|n| (n, k.clone())))
            .collect();
        index.sort_by_key(|(n, _)| *n);
        let mut out: Vec<String> = index.into_iter().map(|(_, k)| k).collect();
        out.extend(
            p.entries
                .iter()
                .filter(|(k, _)| index_key(k).is_none())
                .map(|(k, _)| k.clone()),
        );
        out
    }
    pub fn entries(&self) -> Vec<(String, V)> {
        self.keys()
            .into_iter()
            .map(|k| {
                let v = self.get(&k);
                (k, v)
            })
            .collect()
    }
    pub fn len(&self) -> usize {
        self.0.borrow().entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    pub fn ptr_eq(&self, other: &Ob) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }
    pub fn kept(&self, field: &str) -> Option<Total> {
        self.0
            .borrow()
            .kept
            .iter()
            .find(|(k, _)| k == field)
            .and_then(|(_, t)| t.clone())
    }
    pub fn keep(&self, field: &str, total: Option<Total>) {
        let mut p = self.0.borrow_mut();
        if let Some(slot) = p.kept.iter_mut().find(|(k, _)| k == field) {
            slot.1 = total;
        } else {
            p.kept.push((field.to_owned(), total));
        }
    }
    /// `Object.assign({}, this)`: own properties, no kept bounds.
    pub fn assign_copy(&self) -> Ob {
        let out = Ob::new();
        for (k, v) in self.entries() {
            out.set(&k, v);
        }
        out
    }
    /// `for (key in src) dst[key] = src[key]`.
    pub fn copy_from(&self, src: &Ob) {
        for (k, v) in src.entries() {
            self.set(&k, v);
        }
    }
}
impl Default for Arr {
    fn default() -> Self {
        Self::new()
    }
}
impl Arr {
    pub fn new() -> Self {
        Self(Rc::new(RefCell::new(Vec::new())))
    }
    pub fn from_vec(v: Vec<V>) -> Self {
        Self(Rc::new(RefCell::new(v)))
    }
    pub fn len(&self) -> usize {
        self.0.borrow().len()
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    /// `a[i]` (undefined past the end).
    pub fn at(&self, i: usize) -> V {
        self.0.borrow().get(i).cloned().unwrap_or_default()
    }
    /// `a[i] = v` (extends with holes read as undefined).
    pub fn put(&self, i: usize, v: V) {
        let mut a = self.0.borrow_mut();
        if i >= a.len() {
            a.resize(i + 1, V::Undef);
        }
        a[i] = v;
    }
    pub fn push(&self, v: impl Into<V>) {
        self.0.borrow_mut().push(v.into());
    }
    /// `unshift(...items)`.
    pub fn unshift(&self, items: Vec<V>) {
        let mut a = self.0.borrow_mut();
        let tail = std::mem::take(&mut *a);
        *a = items;
        a.extend(tail);
    }
    /// `pop()`.
    pub fn pop(&self) -> V {
        self.0.borrow_mut().pop().unwrap_or_default()
    }
    /// A snapshot of the elements (shared references).
    pub fn items(&self) -> Vec<V> {
        self.0.borrow().clone()
    }
    pub fn truncate(&self, n: usize) {
        self.0.borrow_mut().truncate(n);
    }
    /// `slice(start)` with a non-negative start.
    pub fn slice_from(&self, start: usize) -> Arr {
        Arr::from_vec(self.0.borrow().iter().skip(start).cloned().collect())
    }
    pub fn filter(&self, mut f: impl FnMut(&V) -> bool) -> Arr {
        Arr::from_vec(self.items().into_iter().filter(|v| f(v)).collect())
    }
    pub fn find(&self, mut f: impl FnMut(&V) -> bool) -> V {
        self.items().into_iter().find(|v| f(v)).unwrap_or_default()
    }
    /// `indexOf` with strict equality.
    pub fn index_of(&self, v: &V) -> Option<usize> {
        self.items().iter().position(|x| strict_eq(x, v))
    }
    /// V8 `Array.prototype.sort` with a comparator.
    pub fn sort_by(&self, mut cmp: impl FnMut(&V, &V) -> f64) {
        let mut items = self.items();
        wjs::js_sort(&mut items, |a, b| {
            let r = cmp(a, b);
            if r > 0. {
                1
            } else if r < 0. {
                -1
            } else {
                0
            }
        });
        *self.0.borrow_mut() = items;
    }
    pub fn ptr_eq(&self, other: &Arr) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }
}

impl From<f64> for V {
    fn from(v: f64) -> Self {
        V::Num(v)
    }
}
impl From<i32> for V {
    fn from(v: i32) -> Self {
        V::Num(f64::from(v))
    }
}
impl From<bool> for V {
    fn from(v: bool) -> Self {
        V::Bool(v)
    }
}
impl From<&str> for V {
    fn from(v: &str) -> Self {
        V::Str(v.into())
    }
}
impl From<String> for V {
    fn from(v: String) -> Self {
        V::Str(v.into())
    }
}
impl From<Ob> for V {
    fn from(v: Ob) -> Self {
        V::Obj(v)
    }
}
impl From<Arr> for V {
    fn from(v: Arr) -> Self {
        V::Arr(v)
    }
}
impl<T: Into<V>> From<Option<T>> for V {
    fn from(v: Option<T>) -> Self {
        v.map_or(V::Undef, Into::into)
    }
}

/// Build an object literal: `obj(&[("a", V::from(1.))])`.
pub fn obj(pairs: Vec<(&str, V)>) -> Ob {
    let o = Ob::new();
    for (k, v) in pairs {
        o.set(k, v);
    }
    o
}

impl V {
    pub fn s(text: &str) -> V {
        V::Str(text.into())
    }
    pub fn is_undef(&self) -> bool {
        matches!(self, V::Undef)
    }
    /// `x == undefined`.
    pub fn nullish(&self) -> bool {
        matches!(self, V::Undef | V::Null)
    }
    pub fn truthy(&self) -> bool {
        match self {
            V::Undef | V::Null => false,
            V::Bool(b) => *b,
            V::Num(n) => *n != 0. && !n.is_nan(),
            V::Str(s) => !s.is_empty(),
            V::Arr(_) | V::Obj(_) | V::Date(_) => true,
        }
    }
    pub fn num(&self) -> Option<f64> {
        match self {
            V::Num(n) => Some(*n),
            _ => None,
        }
    }
    pub fn str(&self) -> Option<&str> {
        match self {
            V::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_obj(&self) -> Option<&Ob> {
        match self {
            V::Obj(o) => Some(o),
            _ => None,
        }
    }
    pub fn as_arr(&self) -> Option<&Arr> {
        match self {
            V::Arr(a) => Some(a),
            _ => None,
        }
    }
    /// The object receiver, or a legacy TypeError for anything else.
    pub fn o(&self) -> &Ob {
        match self {
            V::Obj(o) => o,
            other => throw(format!(
                "TypeError: expected object, got {}",
                type_of(other)
            )),
        }
    }
    /// The array receiver, or a legacy TypeError (e.g. `undefined.forEach`).
    pub fn a(&self) -> &Arr {
        match self {
            V::Arr(a) => a,
            other => throw(format!("TypeError: expected array, got {}", type_of(other))),
        }
    }
    /// Property read with JavaScript rules; reading from undefined/null throws.
    pub fn get(&self, k: &str) -> V {
        match self {
            V::Undef | V::Null => throw(format!(
                "TypeError: Cannot read property '{k}' of {}",
                to_str(self)
            )),
            V::Obj(o) => o.get(k),
            V::Arr(a) => {
                if k == "length" {
                    V::Num(a.len() as f64)
                } else if let Some(i) = index_key(k) {
                    a.at(i as usize)
                } else {
                    V::Undef
                }
            }
            V::Str(s) if k == "length" => V::Num(s.encode_utf16().count() as f64),
            _ => V::Undef,
        }
    }
    /// Property write; writing to undefined/null or a primitive (strict mode) throws.
    pub fn set(&self, k: &str, v: impl Into<V>) {
        match self {
            V::Obj(o) => o.set(k, v),
            other => throw(format!(
                "TypeError: Cannot set property '{k}' of {}",
                to_str(other)
            )),
        }
    }
    /// `hasOwnProperty` (throws on undefined/null like the method call).
    pub fn has(&self, k: &str) -> bool {
        match self {
            V::Undef | V::Null => throw("TypeError: hasOwnProperty of undefined"),
            V::Obj(o) => o.has(k),
            V::Arr(a) => k == "length" || index_key(k).is_some_and(|i| (i as usize) < a.len()),
            V::Str(s) => {
                k == "length"
                    || index_key(k).is_some_and(|i| (i as usize) < s.encode_utf16().count())
            }
            _ => false,
        }
    }
    pub fn del(&self, k: &str) {
        match self {
            V::Obj(o) => o.del(k),
            V::Undef | V::Null => throw("TypeError: Cannot convert undefined or null to object"),
            _ => (),
        }
    }
    pub fn len(&self) -> V {
        self.get("length")
    }
}

pub fn type_of(v: &V) -> &'static str {
    match v {
        V::Undef => "undefined",
        V::Null | V::Arr(_) | V::Obj(_) | V::Date(_) => "object",
        V::Bool(_) => "boolean",
        V::Num(_) => "number",
        V::Str(_) => "string",
    }
}
pub fn is_number(v: &V) -> bool {
    matches!(v, V::Num(_))
}
/// `typeof v === 'number' && isFinite(v)`.
pub fn is_finite_number(v: &V) -> bool {
    matches!(v, V::Num(n) if n.is_finite())
}
/// `String(v)`.
pub fn to_str(v: &V) -> String {
    match v {
        V::Undef => "undefined".into(),
        V::Null => "null".into(),
        V::Bool(b) => b.to_string(),
        V::Num(n) => wjs::num_string(*n),
        V::Str(s) => s.to_string(),
        V::Arr(a) => a
            .items()
            .iter()
            .map(|x| {
                if x.nullish() {
                    String::new()
                } else {
                    to_str(x)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        V::Obj(_) => "[object Object]".into(),
        V::Date(ms) => date_to_string(*ms),
    }
}
/// `Date.prototype.toString` in the UTC process zone.
pub fn date_to_string(ms: f64) -> String {
    const DAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    match wjs::parts(ms) {
        Some(p) => format!(
            "{} {} {:02} {:04} {:02}:{:02}:{:02} GMT+0000 (Coordinated Universal Time)",
            DAYS[p.weekday as usize],
            MONTHS[(p.month - 1) as usize],
            p.day,
            p.year,
            p.hour,
            p.minute,
            p.second
        ),
        None => "Invalid Date".into(),
    }
}
/// ToPrimitive (hint default/number) for the relational operators and `+`.
fn to_primitive(v: &V) -> V {
    match v {
        V::Arr(_) | V::Obj(_) => V::Str(to_str(v).into()),
        V::Date(ms) => V::Num(*ms),
        other => other.clone(),
    }
}
/// `Number(v)` / unary `+v`.
pub fn to_number(v: &V) -> f64 {
    match v {
        V::Undef => f64::NAN,
        V::Null => 0.,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Num(n) => *n,
        V::Str(s) => wjs::string_to_number(s),
        V::Date(ms) => *ms,
        V::Arr(_) | V::Obj(_) => to_number(&to_primitive(v)),
    }
}
/// `a === b`.
pub fn strict_eq(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Undef, V::Undef) | (V::Null, V::Null) => true,
        (V::Bool(x), V::Bool(y)) => x == y,
        (V::Num(x), V::Num(y)) => x == y,
        (V::Str(x), V::Str(y)) => x == y,
        (V::Arr(x), V::Arr(y)) => x.ptr_eq(y),
        (V::Obj(x), V::Obj(y)) => x.ptr_eq(y),
        // Dates are objects: identity is not preserved through clones; legacy never compares them.
        _ => false,
    }
}
/// `a == b`.
pub fn loose_eq(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Undef | V::Null, V::Undef | V::Null) => true,
        (V::Undef | V::Null, _) | (_, V::Undef | V::Null) => false,
        (V::Num(_), V::Str(_)) | (V::Str(_), V::Num(_)) => to_number(a) == to_number(b),
        (V::Bool(_), _) => loose_eq(&V::Num(to_number(a)), b),
        (_, V::Bool(_)) => loose_eq(a, &V::Num(to_number(b))),
        (V::Arr(_) | V::Obj(_) | V::Date(_), V::Num(_) | V::Str(_)) => {
            loose_eq(&to_primitive(a), b)
        }
        (V::Num(_) | V::Str(_), V::Arr(_) | V::Obj(_) | V::Date(_)) => {
            loose_eq(a, &to_primitive(b))
        }
        _ => strict_eq(a, b),
    }
}
fn relational(a: &V, b: &V) -> Option<std::cmp::Ordering> {
    let (pa, pb) = (to_primitive(a), to_primitive(b));
    if let (V::Str(x), V::Str(y)) = (&pa, &pb) {
        return Some(x.encode_utf16().cmp(y.encode_utf16()));
    }
    let (x, y) = (to_number(&pa), to_number(&pb));
    x.partial_cmp(&y)
}
pub fn lt(a: &V, b: &V) -> bool {
    relational(a, b) == Some(std::cmp::Ordering::Less)
}
pub fn gt(a: &V, b: &V) -> bool {
    relational(a, b) == Some(std::cmp::Ordering::Greater)
}
pub fn le(a: &V, b: &V) -> bool {
    matches!(
        relational(a, b),
        Some(std::cmp::Ordering::Less | std::cmp::Ordering::Equal)
    )
}
pub fn ge(a: &V, b: &V) -> bool {
    matches!(
        relational(a, b),
        Some(std::cmp::Ordering::Greater | std::cmp::Ordering::Equal)
    )
}
/// `a + b`.
pub fn add(a: &V, b: &V) -> V {
    let (pa, pb) = (to_primitive_add(a), to_primitive_add(b));
    if matches!(pa, V::Str(_)) || matches!(pb, V::Str(_)) {
        V::Str(format!("{}{}", to_str(&pa), to_str(&pb)).into())
    } else {
        V::Num(to_number(&pa) + to_number(&pb))
    }
}
fn to_primitive_add(v: &V) -> V {
    match v {
        // Date's default hint is string.
        V::Date(ms) => V::Str(date_to_string(*ms).into()),
        other => to_primitive(other),
    }
}
/// `a - b` and other numeric operators use ToNumber.
pub fn sub(a: &V, b: &V) -> f64 {
    to_number(a) - to_number(b)
}
pub fn num_str(n: f64) -> String {
    wjs::num_string(n)
}
/// `+(x).toFixed(d)` on a number receiver; a non-number receiver throws like `.toFixed`.
pub fn fixed(v: &V, digits: usize) -> f64 {
    match v {
        V::Num(n) => wjs::fixed(*n, digits),
        other => throw(format!(
            "TypeError: {}.toFixed is not a function",
            to_str(other)
        )),
    }
}
pub fn round(x: f64) -> f64 {
    wjs::round(x)
}
/// `parseInt(String(v), 10)`.
pub fn parse_int(v: &V) -> f64 {
    let s = to_str(v);
    let t = s.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    let (sign, rest) = match t.as_bytes().first() {
        Some(b'-') => (-1., &t[1..]),
        Some(b'+') => (1., &t[1..]),
        _ => (1., t),
    };
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() {
        f64::NAN
    } else {
        sign * digits.parse::<f64>().unwrap_or(f64::NAN)
    }
}
pub fn parse_float(v: &V) -> f64 {
    wjs::parse_float(&to_str(v))
}

/// String receiver for a string method; anything else throws like the legacy method call.
pub fn sv(v: &V) -> String {
    match v {
        V::Str(s) => s.to_string(),
        other => throw(format!(
            "TypeError: expected string, got {}",
            type_of(other)
        )),
    }
}
fn utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn from16(u: &[u16]) -> String {
    String::from_utf16_lossy(u)
}
/// `s.substr(start, len)` on a string (start >= 0).
pub fn substr(s: &str, start: usize, len: usize) -> String {
    let u = utf16(s);
    let a = start.min(u.len());
    let b = (a + len).min(u.len());
    from16(&u[a..b])
}
/// `s.slice(start, end)` with JavaScript negative indices.
pub fn slice(s: &str, start: i64, end: Option<i64>) -> String {
    let u = utf16(s);
    let n = u.len() as i64;
    let norm = |i: i64| if i < 0 { (n + i).max(0) } else { i.min(n) } as usize;
    let a = norm(start);
    let b = end.map_or(n as usize, norm);
    if a >= b {
        String::new()
    } else {
        from16(&u[a..b])
    }
}

/// `JSON.stringify` conversion (`None` for a top-level undefined).
pub fn to_json(v: &V) -> Option<OrderedJson> {
    Some(match v {
        V::Undef => return None,
        V::Null => OrderedJson::Null,
        V::Bool(b) => OrderedJson::Bool(*b),
        V::Num(n) if n.is_finite() => OrderedJson::Number(*n),
        V::Num(_) => OrderedJson::Null,
        V::Str(s) => OrderedJson::String(utf16(s)),
        V::Date(ms) => wjs::iso(*ms).map_or(OrderedJson::Null, |s| OrderedJson::String(utf16(&s))),
        V::Arr(a) => OrderedJson::Array(
            a.items()
                .iter()
                .map(|x| to_json(x).unwrap_or(OrderedJson::Null))
                .collect(),
        ),
        V::Obj(o) => OrderedJson::Object(
            o.entries()
                .iter()
                .filter_map(|(k, x)| to_json(x).map(|j| (utf16(k), j)))
                .collect(),
        ),
    })
}
/// The value `JSON.parse` produces from OrderedJson.
pub fn from_ordered(j: &OrderedJson) -> V {
    match j {
        OrderedJson::Null => V::Null,
        OrderedJson::Bool(b) => V::Bool(*b),
        OrderedJson::Number(n) => V::Num(*n),
        OrderedJson::String(s) => V::Str(from16(s).into()),
        OrderedJson::Array(a) => V::Arr(Arr::from_vec(a.iter().map(from_ordered).collect())),
        OrderedJson::Object(entries) => {
            let o = Ob::new();
            for (k, x) in entries {
                o.set(&from16(k), from_ordered(x));
            }
            V::Obj(o)
        }
    }
}
/// `JSON.parse(JSON.stringify(v))`.
pub fn json_clone(v: &V) -> V {
    to_json(v).map_or(V::Undef, |j| from_ordered(&j))
}
/// Store input (ordered JSON, Dates as `{"$date": ms}`, `{"$undefined": true}`) to a fresh value.
pub fn from_store(j: &OrderedJson) -> V {
    match j {
        OrderedJson::Array(a) => V::Arr(Arr::from_vec(a.iter().map(from_store).collect())),
        OrderedJson::Object(entries) => {
            if entries.len() == 1 {
                let (k, x) = &entries[0];
                let k = from16(k);
                if k == "$date"
                    && let OrderedJson::Number(ms) = x
                {
                    return V::Date(*ms);
                }
                if k == "$undefined" && *x == OrderedJson::Bool(true) {
                    return V::Undef;
                }
            }
            let o = Ob::new();
            for (k, x) in entries {
                o.set(&from16(k), from_store(x));
            }
            V::Obj(o)
        }
        other => from_ordered(other),
    }
}
/// Serde JSON input (key order is not preserved; use [`from_store`] for store answers).
pub fn from_serde(j: &serde_json::Value) -> V {
    match j {
        serde_json::Value::Null => V::Null,
        serde_json::Value::Bool(b) => V::Bool(*b),
        serde_json::Value::Number(n) => V::Num(n.as_f64().unwrap_or(f64::NAN)),
        serde_json::Value::String(s) => V::Str(s.as_str().into()),
        serde_json::Value::Array(a) => V::Arr(Arr::from_vec(a.iter().map(from_serde).collect())),
        serde_json::Value::Object(m) => {
            if m.len() == 1
                && let Some(ms) = m.get("$date").and_then(serde_json::Value::as_f64)
            {
                return V::Date(ms);
            }
            if m.len() == 1 && m.get("$undefined") == Some(&serde_json::Value::Bool(true)) {
                return V::Undef;
            }
            let o = Ob::new();
            for (k, x) in m {
                o.set(k, from_serde(x));
            }
            V::Obj(o)
        }
    }
}
pub fn js_number_str(n: f64) -> String {
    js_number(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exceptions_unwind_to_catch_only_for_thrown() {
        let r = catch(|| -> i32 { V::Undef.get("x").truthy().into() });
        assert!(r.is_err());
        let ok = catch(|| 3);
        assert_eq!(ok, Ok(3));
        let bug = std::panic::catch_unwind(|| catch(|| -> () { panic!("bug") }));
        assert!(bug.is_err(), "a Rust panic is not a legacy exception");
    }
    #[test]
    fn index_keys_come_first_and_undefined_is_dropped() {
        let o = obj(vec![
            ("b", V::from(1.)),
            ("20260924", V::from(2.)),
            ("a", V::Undef),
            ("3", V::from(3.)),
        ]);
        assert_eq!(o.keys(), ["3", "20260924", "b", "a"]);
        assert_eq!(
            to_json(&V::Obj(o)).unwrap().to_bytes(),
            br#"{"3":3,"20260924":2,"b":1}"#
        );
        assert_eq!(to_json(&V::Num(f64::NAN)).unwrap().to_bytes(), b"null");
    }
    #[test]
    fn coercion_follows_javascript() {
        assert!(loose_eq(&V::Undef, &V::Null));
        assert!(loose_eq(&V::s("1500"), &V::from(1500.)));
        assert!(!strict_eq(&V::s("1500"), &V::from(1500.)));
        assert!(lt(&V::s("0900"), &V::s("1000")));
        assert!(gt(&V::from(10.), &V::s("9")));
        assert!(!lt(&V::Undef, &V::from(1.)));
        assert_eq!(to_str(&add(&V::s("2026"), &V::s("0924"))), "20260924");
        assert_eq!(to_str(&add(&V::from(1.), &V::s("mm"))), "1mm");
        assert_eq!(parse_int(&V::s("0900")), 900.);
        assert_eq!(slice("1500", 0, Some(-2)), "15");
    }
}
