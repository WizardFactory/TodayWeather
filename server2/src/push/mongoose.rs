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
/// `SchemaDate.prototype.cast`. Strings parse as ISO 8601 instants (the forms `Date` itself
/// writes); other free-form date strings are rejected (documented subset).
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
            if !n.is_nan() {
                n
            } else {
                crate::warnings::js::parse_iso(s).map_or(f64::NAN, |ms| ms as f64)
            }
        }
        Val::Arr(_) | Val::Obj(_) => f64::NAN,
    };
    if ms.is_finite() && ms.abs() <= 8.64e15 {
        Ok(Val::Date(ms.trunc()))
    } else {
        Err(fail())
    }
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
}
