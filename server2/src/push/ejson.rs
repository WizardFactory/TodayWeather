//! Record encoding for S3 state objects and the registration import file: JSON with MongoDB
//! Extended JSON wrappers for the BSON kinds JSON lacks (`{"$date": ms}`, non-finite doubles as
//! `{"$numberDouble": "..."}`), field order preserved exactly. The decoder also accepts the
//! relaxed, canonical and legacy forms `mongoexport` writes.
use super::store::{Coll, Oid, Record, oid_hex, parse_oid};
use crate::gateway::{OrderedJson, response::js_number};
use crate::world::js::{Obj, Val};

pub fn write_val(v: &Val, out: &mut String) {
    match v {
        Val::Undef | Val::Null => out.push_str("null"),
        Val::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Val::Num(n) if n.is_finite() => out.push_str(&js_number(*n)),
        Val::Num(n) => {
            let text = if n.is_nan() {
                "NaN"
            } else if *n > 0. {
                "Infinity"
            } else {
                "-Infinity"
            };
            out.push_str(&format!("{{\"$numberDouble\":\"{text}\"}}"));
        }
        Val::Str(s) => write_str(s, out),
        Val::Date(ms) => out.push_str(&format!("{{\"$date\":{}}}", js_number(*ms))),
        Val::Arr(a) => {
            out.push('[');
            for (i, e) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_val(e, out);
            }
            out.push(']');
        }
        Val::Obj(o) => write_obj(o, out),
    }
}
pub fn write_obj(o: &Obj, out: &mut String) {
    out.push('{');
    for (i, (k, v)) in o.entries().iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        write_str(k, out);
        out.push(':');
        write_val(v, out);
    }
    out.push('}');
}
fn write_str(s: &str, out: &mut String) {
    out.push_str(&serde_json::to_string(s).expect("string serialization"));
}

/// One stored record as a JSON line: `{"c":collection,"n":order,"_id":hex,"doc":{...}}`.
pub fn write_record(c: Coll, n: u64, r: &Record, imported: Option<&str>, out: &mut String) {
    let mut doc = String::new();
    write_obj(&r.doc, &mut doc);
    write_encoded(c, n, &r.oid, doc.as_bytes(), imported, out);
}
/// [`write_record`] for an already encoded document; `imported` adds the import digest.
pub fn write_encoded(
    c: Coll,
    n: u64,
    oid: &Oid,
    doc: &[u8],
    imported: Option<&str>,
    out: &mut String,
) {
    out.push_str("{\"c\":\"");
    out.push_str(c.collection());
    out.push_str(&format!("\",\"n\":{n},\"_id\":\"{}\",", oid_hex(oid)));
    if let Some(digest) = imported {
        out.push_str(&format!("\"imported\":\"{digest}\","));
    }
    out.push_str("\"doc\":");
    out.push_str(std::str::from_utf8(doc).expect("encoded documents are UTF-8"));
    out.push('}');
}
/// The import digest of a record line, if any.
pub fn read_imported(v: &OrderedJson) -> Option<String> {
    v.get("imported")
        .and_then(OrderedJson::string)
        .filter(|d| d.len() == 64 && d.bytes().all(|b| b.is_ascii_hexdigit()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodeError(pub &'static str);

fn key(k: &[u16]) -> String {
    String::from_utf16_lossy(k)
}

/// A value from Extended JSON. `$oid` is accepted only where the caller asks (`_id`).
pub fn read_val(v: &OrderedJson) -> Result<Val, DecodeError> {
    Ok(match v {
        OrderedJson::Null => Val::Null,
        OrderedJson::Bool(b) => Val::Bool(*b),
        OrderedJson::Number(n) => Val::Num(*n),
        OrderedJson::String(s) => Val::Str(String::from_utf16_lossy(s)),
        OrderedJson::Array(a) => Val::Arr(a.iter().map(read_val).collect::<Result<_, _>>()?),
        OrderedJson::Object(entries) => {
            if let Some(((k, inner), [])) = entries.split_first()
                && let Some(wrapped) = wrapper(&key(k), inner)?
            {
                return Ok(wrapped);
            }
            let mut o = Obj::new();
            for (k, v) in entries {
                let name = key(k);
                if name.starts_with('$') {
                    return Err(DecodeError("unsupported extended JSON type"));
                }
                o.set(&name, read_val(v)?);
            }
            Val::Obj(o)
        }
    })
}
fn wrapper(name: &str, inner: &OrderedJson) -> Result<Option<Val>, DecodeError> {
    let text = |v: &OrderedJson| v.string().ok_or(DecodeError("extended JSON value"));
    Ok(Some(match name {
        "$date" => Val::Date(date(inner)?),
        "$numberInt" | "$numberLong" => {
            let t = text(inner)?;
            let n: i64 = t
                .parse()
                .map_err(|_| DecodeError("extended JSON integer"))?;
            Val::Num(n as f64)
        }
        "$numberDouble" => Val::Num(match text(inner)?.as_str() {
            "NaN" => f64::NAN,
            "Infinity" => f64::INFINITY,
            "-Infinity" => f64::NEG_INFINITY,
            t => t.parse().map_err(|_| DecodeError("extended JSON double"))?,
        }),
        n if n.starts_with('$') => return Err(DecodeError("unsupported extended JSON type")),
        _ => return Ok(None),
    }))
}
fn date(inner: &OrderedJson) -> Result<f64, DecodeError> {
    let ms = match inner {
        OrderedJson::Number(n) => *n,
        OrderedJson::String(s) => {
            let s = String::from_utf16_lossy(s);
            crate::warnings::js::parse_iso(&iso_millis(&s)).ok_or(DecodeError("$date text"))? as f64
        }
        OrderedJson::Object(entries) => match entries.as_slice() {
            [(k, v)] if key(k) == "$numberLong" => {
                v.string()
                    .and_then(|t| t.parse::<i64>().ok())
                    .ok_or(DecodeError("$date number"))? as f64
            }
            _ => return Err(DecodeError("$date form")),
        },
        _ => return Err(DecodeError("$date form")),
    };
    if !ms.is_finite() || ms.fract() != 0. || ms.abs() > 8.64e15 {
        return Err(DecodeError("$date range"));
    }
    Ok(ms)
}
/// `mongoexport` relaxed dates: `2026-10-15T00:00:00Z` or with milliseconds; normalize to the
/// millisecond form `parse_iso` reads.
fn iso_millis(s: &str) -> String {
    if s.len() == 20 && s.ends_with('Z') && !s.contains('.') {
        format!("{}.000Z", &s[..19])
    } else if let Some(stripped) = s.strip_suffix("+00:00") {
        iso_millis(&format!("{stripped}Z"))
    } else {
        s.to_owned()
    }
}

/// A stored record line.
pub fn read_record(v: &OrderedJson) -> Result<(Coll, u64, Record), DecodeError> {
    let c = v
        .get("c")
        .and_then(OrderedJson::string)
        .and_then(|c| Coll::parse(&c))
        .ok_or(DecodeError("record collection"))?;
    let n = v
        .get("n")
        .and_then(OrderedJson::number)
        .filter(|n| *n >= 0. && n.fract() == 0. && *n < 9e15)
        .ok_or(DecodeError("record order"))? as u64;
    let oid = v
        .get("_id")
        .and_then(OrderedJson::string)
        .and_then(|s| parse_oid(&s))
        .ok_or(DecodeError("record _id"))?;
    let doc = match read_val(v.get("doc").ok_or(DecodeError("record doc"))?)? {
        Val::Obj(o) => o,
        _ => return Err(DecodeError("record doc")),
    };
    Ok((c, n, Record { oid, doc }))
}

/// `_id` from Extended JSON (`{"$oid": hex}`).
pub fn read_oid(v: &OrderedJson) -> Option<Oid> {
    match v {
        OrderedJson::Object(entries) => match entries.as_slice() {
            [(k, inner)] if key(k) == "$oid" => inner.string().and_then(|s| parse_oid(&s)),
            _ => None,
        },
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trip() {
        let mut doc = Obj::new();
        doc.set("updatedAt", Val::Date(1_760_486_400_000.));
        doc.set("pushTime", Val::Num(f64::INFINITY));
        doc.set("geo", Val::Arr(vec![Val::Num(127.1), Val::Num(37.5)]));
        let r = Record { oid: [7; 12], doc };
        let mut s = String::new();
        write_record(Coll::Alert, 5, &r, None, &mut s);
        let parsed = OrderedJson::parse(s.as_bytes()).unwrap();
        let (c, n, back) = read_record(&parsed).unwrap();
        assert_eq!((c, n), (Coll::Alert, 5));
        assert_eq!(back, r);
        let relaxed = OrderedJson::parse(br#"{"$date":"2026-10-15T00:00:00Z"}"#).unwrap();
        assert_eq!(read_val(&relaxed).unwrap(), Val::Date(1_792_022_400_000.));
    }
}
