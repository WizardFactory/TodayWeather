//! The Mongoose 5.1.2 behavior the legacy push store depends on, for the two registration models
//! (`server/models/modelPush.js`, `server/models/alert.push.model.js`): strict schemas, value
//! casts and their `CastError` messages, query casting (`cast.js`), update casting
//! (`services/query/castUpdate.js`) and new-document construction (`new Model(obj)` then
//! `save()`), including the document key order its JSON shows.
use super::js::{self, inspect};
use super::store::{Coll, Cond, Oid, oid_hex};
use crate::world::js::{Obj, Val};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ty {
    Str,
    Num,
    Bool,
    Date,
    /// `[Number]` with a `2d` index (`geo`).
    Geo,
    /// `[Boolean]` (`dayOfWeek`).
    Bools,
    Nested(&'static [(&'static str, Ty)]),
}
use Ty::*;

const TOWN: &[(&str, Ty)] = &[("first", Str), ("second", Str), ("third", Str)];
const UNITS: &[(&str, Ty)] = &[
    ("temperatureUnit", Str),
    ("windSpeedUnit", Str),
    ("pressureUnit", Str),
    ("distanceUnit", Str),
    ("precipitationUnit", Str),
    ("airUnit", Str),
    ("airForecastSource", Str),
];
const PRECIP: &[(&str, Ty)] = &[("lastState", Num), ("pushTime", Date)];
const AIR: &[(&str, Ty)] = &[("lastGrade", Num), ("lastCode", Str), ("pushTime", Date)];

/// `modelPush.js` path order (`_id` and the `__v` version key are added by Mongoose).
const ALARM: &[(&str, Ty)] = &[
    ("type", Str),
    ("registrationId", Str),
    ("fcmToken", Str),
    ("cityIndex", Num),
    ("id", Num),
    ("pushTime", Num),
    ("enable", Bool),
    ("town", Nested(TOWN)),
    ("geo", Geo),
    ("lang", Str),
    ("name", Str),
    ("source", Str),
    ("units", Nested(UNITS)),
    ("updatedAt", Date),
    ("updatedBy", Str),
    ("timezoneOffset", Num),
    ("dayOfWeek", Bools),
    ("package", Str),
    ("uuid", Str),
    ("appVersion", Str),
    ("__v", Num),
];
/// `alert.push.model.js` path order.
const ALERT: &[(&str, Ty)] = &[
    ("type", Str),
    ("registrationId", Str),
    ("fcmToken", Str),
    ("cityIndex", Num),
    ("id", Num),
    ("startTime", Num),
    ("endTime", Num),
    ("reverseTime", Bool),
    ("enable", Bool),
    ("town", Nested(TOWN)),
    ("geo", Geo),
    ("lang", Str),
    ("name", Str),
    ("source", Str),
    ("units", Nested(UNITS)),
    ("package", Str),
    ("uuid", Str),
    ("appVersion", Str),
    ("updatedAt", Date),
    ("updatedBy", Str),
    ("timezoneOffset", Num),
    ("dayOfWeek", Bools),
    ("airAlertsBreakPoint", Num),
    ("precipAlerts", Nested(PRECIP)),
    ("airAlerts", Nested(AIR)),
    ("__v", Num),
];

pub fn schema(c: Coll) -> &'static [(&'static str, Ty)] {
    match c {
        Coll::Alarm => ALARM,
        Coll::Alert => ALERT,
    }
}
fn field(fields: &'static [(&'static str, Ty)], key: &str) -> Option<Ty> {
    fields.iter().find(|(k, _)| *k == key).map(|(_, t)| *t)
}
/// The schema type of a top-level field, if the model declares it.
pub fn field_type(c: Coll, key: &str) -> Option<Ty> {
    field(schema(c), key)
}

/// Mongoose `CastError`, with the ` for model "x"` suffix a query cast adds.
#[derive(Clone, Debug, PartialEq)]
pub struct CastError {
    pub message: String,
}
impl CastError {
    fn new(kind: &str, value: &Val, path: &str) -> Self {
        let mut text = inspect(value);
        if text.starts_with('\'') {
            text.replace_range(..1, "\"");
        }
        if text.len() > 1 && text.ends_with('\'') {
            let end = text.len() - 1;
            text.replace_range(end.., "\"");
        }
        if !text.starts_with('"') {
            text = format!("\"{text}\"");
        }
        Self {
            message: format!("Cast to {kind} failed for value {text} at path \"{path}\""),
        }
    }
    fn for_model(mut self, c: Coll) -> Self {
        self.message
            .push_str(&format!(" for model \"{}\"", c.model()));
        self
    }
}

/// A non-cast exception a Mongoose path throws (reported through the store callback).
pub type CastResult<T> = Result<T, CastError>;

fn id_of(v: &Val) -> Option<&Val> {
    match v {
        Val::Obj(o) if !o.get("_id").is_undef() => Some(o.get("_id")),
        _ => None,
    }
}

/// `SchemaString.prototype.cast`.
fn cast_string(v: &Val, path: &str) -> CastResult<Val> {
    match v {
        Val::Undef | Val::Null => Ok(v.clone()),
        Val::Obj(o) => match o.get("_id") {
            Val::Str(s) => Ok(Val::Str(s.clone())),
            _ => Err(CastError::new("string", v, path)),
        },
        Val::Date(_) => Err(CastError::new("string", v, path)),
        other => Ok(Val::Str(js::to_string(other))),
    }
}
/// `SchemaNumber.prototype.cast`.
fn cast_number(v: &Val, path: &str) -> CastResult<Val> {
    let val = id_of(v).unwrap_or(v);
    if !matches!(val, Val::Undef) && !js::is_nan(val) {
        match val {
            Val::Null => return Ok(Val::Null),
            Val::Str(s) if s.is_empty() => return Ok(Val::Null),
            Val::Str(_) | Val::Bool(_) => return Ok(Val::Num(js::number(val))),
            Val::Num(n) => return Ok(Val::Num(*n)),
            Val::Date(ms) => return Ok(Val::Num(*ms)),
            _ => (),
        }
    }
    Err(CastError::new("number", v, path))
}
/// `SchemaBoolean.prototype.cast` (strict lists).
fn cast_bool(v: &Val, path: &str) -> CastResult<Val> {
    match v {
        Val::Undef | Val::Null => Ok(v.clone()),
        Val::Bool(b) => Ok(Val::Bool(*b)),
        Val::Num(n) if *n == 1. => Ok(Val::Bool(true)),
        Val::Num(n) if *n == 0. => Ok(Val::Bool(false)),
        Val::Str(s) if s == "true" || s == "1" || s == "yes" => Ok(Val::Bool(true)),
        Val::Str(s) if s == "false" || s == "0" || s == "no" => Ok(Val::Bool(false)),
        _ => Err(CastError::new("boolean", v, path)),
    }
}
/// `SchemaDate.prototype.cast`: a numeric string at or beyond year 275760 is milliseconds;
/// any other string goes through `new Date(string)` ([`date_string`]); arrays and objects
/// through their primitive value.
fn cast_date(v: &Val, path: &str) -> CastResult<Val> {
    let fail = || CastError::new("date", v, path);
    let ms = match v {
        Val::Undef | Val::Null => return Ok(Val::Null),
        Val::Str(s) if s.is_empty() => return Ok(Val::Null),
        Val::Date(ms) => *ms,
        Val::Bool(_) => return Err(fail()),
        Val::Num(n) => *n,
        Val::Str(s) => {
            let n = crate::world::js::string_to_number(s);
            if !n.is_nan() && !(-271820. ..275761.).contains(&n) {
                n
            } else {
                date_string(s)
            }
        }
        // `new Date(value.valueOf())`: an array or object is converted to its primitive string.
        Val::Arr(_) | Val::Obj(_) => date_string(&super::js::to_string(v)),
    };
    if ms.is_finite() && ms.abs() <= 8.64e15 {
        Ok(Val::Date(ms.trunc()))
    } else {
        Err(fail())
    }
}
/// `new Date(string).getTime()` for the ECMAScript date-time string format (`YYYY`,
/// `YYYY-MM`, `YYYY-MM-DD`, optional `THH:mm`, `:ss`, `.sss`, `Z` or `±HH:mm`, and the `±YYYYYY`
/// extended year): date-only forms are UTC; date-times without an offset are local time, taken
/// as UTC like every server2 port (S02 oracle normalization; the service host's effective zone
/// is unrecorded). Other text (V8's legacy free-form parser) casts as an invalid date: a
/// recorded difference for fields the app never sends (`precipAlerts`/`airAlerts.pushTime`).
pub fn date_string(s: &str) -> f64 {
    let b = s.as_bytes();
    let mut i = 0;
    let digits = |i: &mut usize, n: usize| -> Option<i64> {
        let part = s.get(*i..*i + n)?;
        if !part.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        *i += n;
        part.parse().ok()
    };
    let mut parse = || -> Option<f64> {
        let year = match b.first()? {
            b'+' | b'-' => {
                let sign = if b[0] == b'-' { -1 } else { 1 };
                i = 1;
                let y = digits(&mut i, 6)?;
                if sign == -1 && y == 0 {
                    return None;
                }
                sign * y
            }
            _ => digits(&mut i, 4)?,
        };
        let (mut month, mut day) = (1, 1);
        if b.get(i) == Some(&b'-') {
            i += 1;
            month = digits(&mut i, 2)?;
            if b.get(i) == Some(&b'-') {
                i += 1;
                day = digits(&mut i, 2)?;
            }
        }
        let (mut h, mut mi, mut sec, mut ms) = (0, 0, 0, 0);
        let mut offset: Option<i64> = Some(0);
        if b.get(i) == Some(&b'T') {
            i += 1;
            h = digits(&mut i, 2)?;
            if b.get(i) != Some(&b':') {
                return None;
            }
            i += 1;
            mi = digits(&mut i, 2)?;
            if b.get(i) == Some(&b':') {
                i += 1;
                sec = digits(&mut i, 2)?;
                if b.get(i) == Some(&b'.') {
                    i += 1;
                    let start = i;
                    while b.get(i).is_some_and(u8::is_ascii_digit) {
                        i += 1;
                    }
                    if i == start {
                        return None;
                    }
                    ms = format!("{:0<3}", &s[start..i])[..3].parse().ok()?;
                }
            }
            // A date-time without an offset is local time (UTC on the legacy host).
            offset = Some(0);
            match b.get(i) {
                Some(b'Z') => i += 1,
                Some(b'+' | b'-') => {
                    let sign = if b[i] == b'-' { -1 } else { 1 };
                    i += 1;
                    let oh = digits(&mut i, 2)?;
                    if b.get(i) != Some(&b':') {
                        return None;
                    }
                    i += 1;
                    let om = digits(&mut i, 2)?;
                    if oh > 23 || om > 59 {
                        return None;
                    }
                    offset = Some(sign * (oh * 60 + om));
                }
                _ => (),
            }
        }
        if i != b.len()
            || !(1..=12).contains(&month)
            || day < 1
            || day > crate::world::js::days_in_month(year, month)
            || h > 24
            || mi > 59
            || sec > 59
            || (h == 24 && (mi, sec, ms) != (0, 0, 0))
        {
            return None;
        }
        let days = crate::world::js::days_from_civil(year, month, day);
        let local = days * 86_400_000 + h * 3_600_000 + mi * 60_000 + sec * 1000 + ms;
        let t = (local - offset? * 60_000) as f64;
        (t.abs() <= 8.64e15).then_some(t)
    };
    parse().unwrap_or(f64::NAN)
}

/// `SchemaArray.prototype.cast` for `[Number]`/`[Boolean]` with a document or query context:
/// the 2d-index special case makes an empty `geo` array `undefined`.
fn cast_array(ty: Ty, v: &Val, path: &str) -> CastResult<Val> {
    let items = match v {
        Val::Arr(a) => a.clone(),
        other => vec![other.clone()],
    };
    if items.is_empty() && ty == Geo {
        return Ok(Val::Undef);
    }
    let mut out = items.clone();
    for i in 0..out.len() {
        let cast = match ty {
            Geo => cast_number(&out[i], path),
            _ => cast_bool(&out[i], path),
        };
        match cast {
            Ok(v) => out[i] = v,
            Err(_) => {
                let kind = if ty == Geo { "[number]" } else { "[boolean]" };
                let shown = Val::Str(super::js::inspect_mongoose_array(&out, path));
                return Err(CastError::new(kind, &shown, path));
            }
        }
    }
    Ok(Val::Arr(out))
}
/// `castForQuery` of a leaf path for an update `$set` value or a query value.
fn cast_leaf(ty: Ty, v: &Val, path: &str) -> CastResult<Val> {
    // `applySetters` returns null/undefined before any cast.
    if v.is_nullish() {
        return Ok(v.clone());
    }
    match ty {
        Str => cast_string(v, path),
        Num => cast_number(v, path),
        Bool => cast_bool(v, path),
        Date => cast_date(v, path),
        Geo | Bools => cast_array(ty, v, path),
        Nested(_) => Ok(v.clone()),
    }
}

/// `Query.prototype.cast` over a flat filter, iterated last key first as `cast.js` does.
/// Operator objects (`{$ne: ...}`) are rejected like a plain object value instead of being
/// passed to MongoDB (deliberate: no query-operator injection).
pub fn cast_query(c: Coll, filter: &[(String, Val)]) -> CastResult<Vec<(String, Cond)>> {
    let mut out: Vec<(String, Cond)> = Vec::with_capacity(filter.len());
    for (key, value) in filter.iter().rev() {
        let ty = field_type(c, key).unwrap_or(Str);
        let cond = match value {
            Val::Undef | Val::Null => Cond::Eq(Val::Null),
            Val::Arr(items) if !matches!(ty, Geo | Bools) => Cond::In(
                items
                    .iter()
                    .map(|v| cast_leaf(ty, v, key).map(|v| null_of(&v)))
                    .collect::<CastResult<_>>()
                    .map_err(|e| e.for_model(c))?,
            ),
            v => Cond::Eq(null_of(&cast_leaf(ty, v, key).map_err(|e| e.for_model(c))?)),
        };
        out.push((key.clone(), cond));
    }
    out.reverse();
    Ok(out)
}
fn null_of(v: &Val) -> Val {
    if v.is_undef() { Val::Null } else { v.clone() }
}

/// One cast `$set` entry: a field name and its stored value (`Undef` stores `null`).
pub type SetEntry = (String, Val);

/// `castUpdate` + `walkUpdatePath` for a `$set` document (strict schema). With `sugar` (a plain
/// update object) the fields are gathered into `$set` last key first and walked last key first,
/// so casting (and the first reported error) follows body order; an explicit `{$set: obj}` is
/// walked last key first. The result keeps body order.
pub fn cast_set(c: Coll, set: &Obj, sugar: bool) -> CastResult<Vec<SetEntry>> {
    let mut walk: Vec<(usize, &(String, Val))> = set.entries().iter().enumerate().collect();
    if !sugar {
        walk.reverse();
    }
    let mut out: Vec<(usize, SetEntry)> = Vec::new();
    for (index, (key, value)) in walk {
        if key.starts_with('$') {
            // Update operators in a request body are not passed on (no operator injection).
            continue;
        }
        if key == "_id" {
            // `_id` casts as an ObjectId; a castable value is not applied (MongoDB refuses to
            // change `_id`; an upsert would otherwise take a client-chosen id).
            cast_object_id(value)?;
            continue;
        }
        if let Some((parent, child)) = key.split_once('.') {
            // A dotted path to a declared nested field sets that field.
            if let Some(Nested(fields)) = field_type(c, parent)
                && let Some(ty) = field(fields, child)
            {
                out.push((index, (key.clone(), cast_leaf(ty, value, key)?)));
            }
            continue;
        }
        let Some(ty) = field_type(c, key) else {
            continue;
        };
        let v = match (ty, value) {
            (Nested(fields), Val::Obj(sub)) => Val::Obj(cast_nested(fields, sub, key)?),
            (Nested(_), other) => other.clone(),
            (Geo | Bools, Val::Obj(_)) => {
                let kind = if ty == Geo { "[number]" } else { "[boolean]" };
                let shown = Val::Str(super::js::inspect_mongoose_array(
                    std::slice::from_ref(value),
                    key,
                ));
                return Err(CastError::new(kind, &shown, key));
            }
            (ty, v) => cast_leaf(ty, v, key)?,
        };
        out.push((index, (key.clone(), v)));
    }
    out.sort_by_key(|(i, _)| *i);
    Ok(out.into_iter().map(|(_, e)| e).collect())
}

/// `SchemaObjectId` cast: a 24-digit hex string, a 12-character string or a number.
fn cast_object_id(v: &Val) -> CastResult<()> {
    match v {
        Val::Undef | Val::Null | Val::Num(_) => Ok(()),
        Val::Str(s) if s.encode_utf16().count() == 12 => Ok(()),
        Val::Str(s) if s.len() == 24 && s.bytes().all(|b| b.is_ascii_hexdigit()) => Ok(()),
        _ => Err(CastError::new("ObjectId", v, "_id")),
    }
}

/// MongoDB 3.4 refuses a `$set` that names a field and one of its sub-fields together.
pub fn set_conflict(set: &[SetEntry]) -> Option<String> {
    for (a, _) in set {
        for (b, _) in set {
            if b.len() > a.len() && b.starts_with(a.as_str()) && b.as_bytes()[a.len()] == b'.' {
                return Some(format!("Cannot update '{a}' and '{b}' at the same time"));
            }
        }
    }
    None
}

fn cast_nested(fields: &'static [(&'static str, Ty)], sub: &Obj, prefix: &str) -> CastResult<Obj> {
    // Walked last key first; unknown keys are dropped and the remaining order is kept.
    let mut kept: Vec<(String, Val)> = Vec::new();
    for (k, v) in sub.entries().iter().rev() {
        let Some(ty) = field(fields, k) else {
            continue;
        };
        let path = format!("{prefix}.{k}");
        let v = cast_leaf(ty, v, &path)?;
        kept.push((k.clone(), v));
    }
    kept.reverse();
    let mut out = Obj::new();
    for (k, v) in kept {
        out.set(&k, v);
    }
    Ok(out)
}

/// The MongoDB 3.4 `2d` index error for a `geo` point outside the default bounds (exact server
/// wording not re-verified against a live 3.4 server; the error/status mapping is the contract).
pub const GEO_BOUNDS: &str = "point not in interval of [ -180, 180 )";

/// The legacy `geo` field has a `2d` index (default bounds [-180, 180)): a document whose
/// `geo` array holds a point outside them cannot be written.
pub fn geo_index_error(doc: &Obj) -> Option<String> {
    let Val::Arr(point) = doc.get("geo") else {
        return None;
    };
    if point.is_empty() {
        return None;
    }
    let inside = |v: Option<&Val>| matches!(v, Some(Val::Num(n)) if (-180. ..180.).contains(n));
    (!(inside(point.first()) && inside(point.get(1)))).then(|| GEO_BOUNDS.to_owned())
}

/// Apply a cast `$set` to a stored document (MongoDB: replace in place, append new fields; a
/// dotted path sets the field inside its embedded document, creating it when needed).
pub fn apply_set(doc: &mut Obj, set: &[SetEntry]) {
    for (k, v) in set {
        match k.split_once('.') {
            Some((parent, child)) => {
                let mut inner = match doc.get(parent) {
                    Val::Obj(o) => o.clone(),
                    _ => Obj::new(),
                };
                inner.set(child, stored(v));
                doc.set(parent, Val::Obj(inner));
            }
            None => doc.set(k, stored(v)),
        }
    }
}
/// The BSON value a JavaScript value is stored as (`undefined` becomes `null`).
pub fn stored(v: &Val) -> Val {
    match v {
        Val::Undef => Val::Null,
        Val::Arr(a) => Val::Arr(a.iter().map(stored).collect()),
        Val::Obj(o) => {
            let mut out = Obj::new();
            for (k, v) in o.entries() {
                out.set(k, stored(v));
            }
            Val::Obj(out)
        }
        other => other.clone(),
    }
}

/// `new Model(obj)` followed by `save()`: the stored document (without `_id`) and the document
/// the save callback returns (its JSON form is the response), or `None` when validation (a
/// cast) fails.
pub fn new_document(c: Coll, obj: &Obj, oid: Oid) -> Option<(Obj, Obj)> {
    let fields = schema(c);
    let mut doc = Obj::new();
    // $__buildDoc: nested containers in schema order.
    for (k, ty) in fields {
        if matches!(ty, Nested(_)) {
            doc.set(k, Val::Obj(Obj::new()));
        }
    }
    // Defaults applied before the setters, in schema order; `_id` last.
    for (k, ty) in fields {
        match (*k, ty) {
            ("enable", _) => doc.set(k, true),
            ("reverseTime", _) => doc.set(k, false),
            (_, Bools) => doc.set(k, Val::Arr(vec![])),
            _ => (),
        }
    }
    doc.set("_id", Val::Str(oid_hex(&oid)));
    for (k, v) in obj.entries() {
        if k == "_id" || k.starts_with('$') {
            continue;
        }
        if let Some((parent, child)) = k.split_once('.') {
            if let (Some(Nested(sub_fields)), Some(mut target)) =
                (field(fields, parent), doc.get(parent).obj().cloned())
                && let Some(sty) = field(sub_fields, child)
            {
                target.set(child, cast_leaf(sty, v, k).ok()?);
                doc.set(parent, Val::Obj(target));
            }
            continue;
        }
        let Some(ty) = field(fields, k) else {
            continue;
        };
        match (ty, v) {
            (Nested(sub_fields), Val::Obj(sub)) => {
                let mut target = match doc.get(k) {
                    Val::Obj(o) => o.clone(),
                    _ => Obj::new(),
                };
                for (sk, sv) in sub.entries() {
                    let Some(sty) = field(sub_fields, sk) else {
                        continue;
                    };
                    let path = format!("{k}.{sk}");
                    target.set(sk, cast_leaf(sty, sv, &path).ok()?);
                }
                doc.set(k, Val::Obj(target));
            }
            // A nested path given anything but an object is ignored by the strict setter.
            (Nested(_), _) => (),
            (Geo | Bools, Val::Obj(_)) => return None,
            (Geo | Bools, Val::Null | Val::Undef) => doc.set(k, v.clone()),
            (Geo | Bools, v) => doc.set(k, cast_array(ty, v, k).ok()?),
            (ty, v) => doc.set(k, cast_leaf(ty, v, k).ok()?),
        }
    }
    let mut doc = minimize(doc);
    doc.set("__v", 0.);
    let mut stored_doc = Obj::new();
    for (k, v) in doc.entries() {
        if k != "_id" && !v.is_undef() {
            stored_doc.set(k, stored(v));
        }
    }
    Some((stored_doc, doc))
}
/// `minimize`: drop empty embedded documents.
fn minimize(doc: Obj) -> Obj {
    let mut out = Obj::new();
    for (k, v) in doc.entries() {
        match v {
            Val::Obj(o) => {
                let o = minimize(o.clone());
                if !o.entries().is_empty() {
                    out.set(k, Val::Obj(o));
                }
            }
            v => out.set(k, v.clone()),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cast_messages() {
        assert_eq!(
            cast_number(&Val::Str("abc".into()), "id")
                .unwrap_err()
                .message,
            "Cast to number failed for value \"abc\" at path \"id\""
        );
        let mut o = Obj::new();
        o.set("a", 1.);
        assert_eq!(
            cast_string(&Val::Obj(o), "fcmToken").unwrap_err().message,
            "Cast to string failed for value \"{ a: 1 }\" at path \"fcmToken\""
        );
        assert_eq!(cast_number(&Val::Str("".into()), "x").unwrap(), Val::Null);
        assert_eq!(
            cast_number(&Val::Str(" 12 ".into()), "x").unwrap(),
            Val::Num(12.)
        );
        assert_eq!(
            cast_string(&Val::Arr(vec![Val::Num(1.), Val::Null]), "x").unwrap(),
            Val::Str("1,".into())
        );
    }
    /// Expected values from Mongoose 5.1.2 `SchemaDate` on Node 16.20.2 (`TZ=UTC`), probed with
    /// the pinned S18 oracle runtime.
    #[test]
    fn date_casts_match_mongoose() {
        let s = |v: &str| Val::Str(v.into());
        for (value, expected) in [
            (s("2020"), Some(1_577_836_800_000.)),
            (s("2020-10"), Some(1_601_510_400_000.)),
            (s("2020-10-01"), Some(1_601_510_400_000.)),
            (s("2020-10-01T00:00"), Some(1_601_510_400_000.)),
            (s("2020-10-01T09:30:15.5+09:00"), Some(1_601_512_215_500.)),
            (s("+002020-01-01T00:00:00Z"), Some(1_577_836_800_000.)),
            (s("275761"), Some(275_761.)),
            (s("-271821"), Some(-271_821.)),
            (s("1600000000000"), Some(1_600_000_000_000.)),
            (s("2020-10-01T24:00"), Some(1_601_596_800_000.)),
            (Val::Arr(vec![s("2020")]), Some(1_577_836_800_000.)),
            (Val::Num(1_600_000_000_000.), Some(1_600_000_000_000.)),
            (Val::Obj(Obj::new()), None),
            (Val::Bool(true), None),
        ] {
            let got = cast_date(&value, "airAlerts.pushTime").ok();
            assert_eq!(got, expected.map(Val::Date), "{value:?}");
        }
        // V8's legacy free-form parser is not ported (recorded difference): these are cast
        // errors here, while Mongoose stores 2020-10-01, 2020-01-01, +275760-01-01, 2020-03-01.
        for text in ["Oct 1 2020", " 2020", "275760", "2020-02-30"] {
            assert!(cast_date(&s(text), "p").is_err(), "{text}");
        }
    }
}
