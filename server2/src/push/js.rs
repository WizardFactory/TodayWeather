//! JavaScript semantics the legacy push routes rely on (pinned Node 16.20.2 / V8 9.4): own
//! property tests, `length` reads, loose `== undefined`, `ToString`, relational `>`, `typeof` and
//! the `util.inspect` subset that Mongoose 5.1.2 cast error messages print.
use crate::world::js::{Obj, Val, num_string, string_to_number};

/// A TypeError the legacy code throws (message text as V8 prints it).
pub type Thrown = String;

fn read_error(v: &Val, prop: &str) -> Thrown {
    let what = if matches!(v, Val::Null) {
        "null"
    } else {
        "undefined"
    };
    format!("Cannot read properties of {what} (reading '{prop}')")
}

/// `expr.hasOwnProperty(key)`. A `null`-prototype receiver (`querystring.parse` result) or an
/// own `hasOwnProperty` data property makes the call a TypeError, as in V8.
pub fn has_own(expr: &str, v: &Val, key: &str, null_proto: bool) -> Result<bool, Thrown> {
    match v {
        Val::Undef | Val::Null => Err(read_error(v, "hasOwnProperty")),
        Val::Obj(o) => {
            if null_proto || o.has("hasOwnProperty") {
                return Err(format!("{expr}.hasOwnProperty is not a function"));
            }
            Ok(o.has(key))
        }
        Val::Arr(a) => Ok(key == "length" || index(key).is_some_and(|i| i < a.len())),
        Val::Str(s) => {
            Ok(key == "length" || index(key).is_some_and(|i| i < s.encode_utf16().count()))
        }
        Val::Num(_) | Val::Bool(_) | Val::Date(_) => Ok(false),
    }
}

fn index(key: &str) -> Option<usize> {
    if key.is_empty() || (key.len() > 1 && key.starts_with('0')) {
        return None;
    }
    key.parse::<u32>()
        .ok()
        .filter(|n| *n != u32::MAX)
        .map(|n| n as usize)
}

/// Property read `v[key]` with V8's TypeError for `null`/`undefined` receivers.
pub fn prop(v: &Val, key: &str) -> Result<Val, Thrown> {
    Ok(match v {
        Val::Undef | Val::Null => return Err(read_error(v, key)),
        Val::Obj(o) => o.get(key).clone(),
        Val::Arr(a) => {
            if key == "length" {
                Val::Num(a.len() as f64)
            } else {
                index(key)
                    .and_then(|i| a.get(i).cloned())
                    .unwrap_or(Val::Undef)
            }
        }
        Val::Str(s) => {
            let units: Vec<u16> = s.encode_utf16().collect();
            if key == "length" {
                Val::Num(units.len() as f64)
            } else {
                index(key)
                    .and_then(|i| units.get(i))
                    .map_or(Val::Undef, |u| {
                        Val::Str(String::from_utf16_lossy(std::slice::from_ref(u)))
                    })
            }
        }
        Val::Num(_) | Val::Bool(_) | Val::Date(_) => Val::Undef,
    })
}

/// `x === 0`.
pub fn is_zero(v: &Val) -> bool {
    matches!(v, Val::Num(n) if *n == 0.)
}

/// `x == undefined` (undefined or null).
pub fn nullish(v: &Val) -> bool {
    v.is_nullish()
}

pub fn is_number(v: &Val) -> bool {
    matches!(v, Val::Num(_))
}

/// ECMAScript `ToString` for the JSON value kinds (plus Date as its `toString` is never used here).
pub fn to_string(v: &Val) -> String {
    match v {
        Val::Undef => "undefined".into(),
        Val::Null => "null".into(),
        Val::Bool(b) => b.to_string(),
        Val::Num(n) => num_string(*n),
        Val::Str(s) => s.clone(),
        Val::Arr(a) => a
            .iter()
            .map(|e| {
                if e.is_nullish() {
                    String::new()
                } else {
                    to_string(e)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Val::Obj(_) => "[object Object]".into(),
        Val::Date(ms) => num_string(*ms),
    }
}

/// `ToPrimitive(v, number)` then the relational comparison `a > b` (`undefined` result is false).
pub fn greater(a: &Val, b: &Val) -> bool {
    let pa = primitive(a);
    let pb = primitive(b);
    if let (Val::Str(x), Val::Str(y)) = (&pa, &pb) {
        let x: Vec<u16> = x.encode_utf16().collect();
        let y: Vec<u16> = y.encode_utf16().collect();
        return x > y;
    }
    let (x, y) = (number(&pa), number(&pb));
    !x.is_nan() && !y.is_nan() && x > y
}

/// `x < y` for the same primitive kinds.
pub fn less(a: &Val, b: &Val) -> bool {
    greater(b, a)
}

/// `a >= b` (false when either side is NaN).
pub fn ge(a: &Val, b: &Val) -> bool {
    !less(a, b) && comparable(a, b)
}
/// `a <= b` (false when either side is NaN).
pub fn le(a: &Val, b: &Val) -> bool {
    !greater(a, b) && comparable(a, b)
}
fn comparable(a: &Val, b: &Val) -> bool {
    let (pa, pb) = (primitive(a), primitive(b));
    matches!((&pa, &pb), (Val::Str(_), Val::Str(_)))
        || (!number(&pa).is_nan() && !number(&pb).is_nan())
}

/// `a == b` (abstract equality) for JSON-like values: objects compare by identity, which two
/// distinct values never share.
pub fn loose_eq(a: &Val, b: &Val) -> bool {
    match (a, b) {
        (Val::Undef | Val::Null, Val::Undef | Val::Null) => true,
        (Val::Undef | Val::Null, _) | (_, Val::Undef | Val::Null) => false,
        (Val::Str(x), Val::Str(y)) => x == y,
        (Val::Bool(x), Val::Bool(y)) => x == y,
        (Val::Arr(_) | Val::Obj(_), Val::Arr(_) | Val::Obj(_)) => false,
        _ => {
            let (pa, pb) = (primitive(a), primitive(b));
            if let (Val::Str(x), Val::Str(y)) = (&pa, &pb) {
                return x == y;
            }
            number(&pa) == number(&pb)
        }
    }
}

/// `a === b` for primitives (objects never equal here).
pub fn strict_eq(a: &Val, b: &Val) -> bool {
    match (a, b) {
        (Val::Undef, Val::Undef) | (Val::Null, Val::Null) => true,
        (Val::Num(x), Val::Num(y)) => x == y,
        (Val::Str(x), Val::Str(y)) => x == y,
        (Val::Bool(x), Val::Bool(y)) => x == y,
        _ => false,
    }
}

/// `parseInt(String(v))` with radix detection (`0x` is hexadecimal).
pub fn parse_int(v: &Val) -> f64 {
    let s = to_string(v);
    let t = s.trim_start_matches(crate::world::js::is_js_space);
    let (sign, rest) = match t.as_bytes().first() {
        Some(b'-') => (-1., &t[1..]),
        Some(b'+') => (1., &t[1..]),
        _ => (1., t),
    };
    let (radix, digits) = if rest.len() >= 2 && (rest.starts_with("0x") || rest.starts_with("0X")) {
        (16, &rest[2..])
    } else {
        (10, rest)
    };
    let mut value = 0f64;
    let mut any = false;
    for c in digits.chars() {
        let Some(d) = c.to_digit(radix) else { break };
        value = value * f64::from(radix) + f64::from(d);
        any = true;
    }
    if any { sign * value } else { f64::NAN }
}

/// `encodeURIComponent` (unreserved: A-Z a-z 0-9 - _ . ! ~ * ' ( )).
pub fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(char::from(b));
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn primitive(v: &Val) -> Val {
    match v {
        Val::Arr(_) | Val::Obj(_) => Val::Str(to_string(v)),
        Val::Date(ms) => Val::Num(*ms),
        other => other.clone(),
    }
}

/// ECMAScript `ToNumber`.
pub fn number(v: &Val) -> f64 {
    match v {
        Val::Undef => f64::NAN,
        Val::Null => 0.,
        Val::Bool(b) => f64::from(u8::from(*b)),
        Val::Num(n) => *n,
        Val::Str(s) => string_to_number(s),
        Val::Date(ms) => *ms,
        Val::Arr(_) | Val::Obj(_) => string_to_number(&to_string(v)),
    }
}

/// Global `isNaN(v)`.
pub fn is_nan(v: &Val) -> bool {
    number(v).is_nan()
}

/// `JSON.stringify(v)` of a JavaScript value (`undefined` properties are omitted).
pub fn stringify(v: &Val) -> String {
    String::from_utf8(v.to_json()).expect("JSON text is UTF-8")
}

/// V8 message for assigning a property to a primitive in strict mode.
pub fn create_property_error(key: &str, v: &Val) -> Thrown {
    let (kind, text) = match v {
        Val::Str(s) => ("string", s.clone()),
        Val::Num(n) => ("number", num_string(*n)),
        Val::Bool(b) => ("boolean", b.to_string()),
        _ => ("object", to_string(v)),
    };
    format!("Cannot create property '{key}' on {kind} '{text}'")
}

/// The subset of Node 16 `util.inspect` that Mongoose cast messages use: primitives, arrays and
/// plain objects with the default options (depth 2, breakLength 128, compact 3). Long-array
/// grouping is not modelled; arrays above six entries print one entry per line when they do not
/// fit one line.
pub fn inspect(v: &Val) -> String {
    match v {
        // `formatPrimitive`: a long top-level string is split after each newline into quoted
        // pieces joined with ` +\n  `.
        Val::Str(s) if s.encode_utf16().count() > 124 && s.contains('\n') => s
            .split_inclusive('\n')
            .map(quote)
            .collect::<Vec<_>>()
            .join(" +\n  "),
        v => inspect_at(v, 0, 0),
    }
}

/// `util.inspect` of a Mongoose 5.1.2 `MongooseArray` built outside a document (an update
/// cast): the elements, then the array mixin's own enumerable properties.
pub fn inspect_mongoose_array(items: &[Val], path: &str) -> String {
    const MIXIN: [&str; 25] = [
        "toBSON: [Function: toBSON]",
        "_atomics: {}",
        "_parent: undefined",
        "_cast: [Function: _cast]",
        "_markModified: [Function: _markModified]",
        "_registerAtomic: [Function: _registerAtomic]",
        "'$__getAtomics': [Function: $__getAtomics]",
        "hasAtomics: [Function: hasAtomics]",
        "_mapCast: [Function: _mapCast]",
        "push: [Function: push]",
        "nonAtomicPush: [Function: nonAtomicPush]",
        "'$pop': [Function: $pop]",
        "pop: [Function: pop]",
        "'$shift': [Function: $shift]",
        "shift: [Function: shift]",
        "pull: [Function: pull]",
        "splice: [Function: splice]",
        "unshift: [Function: unshift]",
        "sort: [Function: sort]",
        "addToSet: [Function: addToSet]",
        "set: [Function: set]",
        "toObject: [Function: toObject]",
        "inspect: [Function: inspect]",
        "indexOf: [Function: indexOf]",
        "remove: [Function: pull]",
    ];
    let mut entries: Vec<String> = items.iter().map(|v| inspect_at(v, 1, 2)).collect();
    entries.extend(MIXIN.iter().map(|e| (*e).to_owned()));
    entries.push(format!("_path: {}", quote(path)));
    entries.push("isMongooseArray: true".into());
    entries.push("validators: []".into());
    entries.push("_schema: undefined".into());
    format!("[\n  {}\n]", entries.join(",\n  "))
}

fn inspect_at(v: &Val, depth: usize, indent: usize) -> String {
    match v {
        Val::Undef => "undefined".into(),
        Val::Null => "null".into(),
        Val::Bool(b) => b.to_string(),
        Val::Num(n) => {
            if *n == 0. && n.is_sign_negative() {
                "-0".into()
            } else {
                num_string(*n)
            }
        }
        Val::Str(s) => quote(s),
        Val::Date(ms) => crate::world::js::iso(*ms).unwrap_or_else(|| "Invalid Date".into()),
        Val::Arr(a) => {
            if a.is_empty() {
                return "[]".into();
            }
            if depth > 2 {
                return "[Array]".into();
            }
            let mut out: Vec<String> = a
                .iter()
                .take(100)
                .map(|e| inspect_at(e, depth + 1, indent + 2))
                .collect();
            if a.len() > 100 {
                let more = a.len() - 100;
                out.push(format!(
                    "... {more} more item{}",
                    if more > 1 { "s" } else { "" }
                ));
            }
            reduce(&out, "[", "]", depth, indent)
        }
        Val::Obj(o) => {
            if o.entries().is_empty() {
                return "{}".into();
            }
            if depth > 2 {
                return "[Object]".into();
            }
            let out: Vec<String> = o
                .entries()
                .iter()
                .map(|(k, v)| format!("{}: {}", key(k), inspect_at(v, depth + 1, indent + 2)))
                .collect();
            reduce(&out, "{", "}", depth, indent)
        }
    }
}

fn reduce(out: &[String], open: &str, close: &str, depth: usize, indent: usize) -> String {
    // `reduceToSingleString`: the innermost three levels may share one line when they fit.
    let start = out.len() + indent + open.len() + 10;
    let total: usize = out.iter().map(|e| e.chars().count()).sum::<usize>() + out.len() + start;
    if depth < 3 && total <= 128 && !out.iter().any(|e| e.contains('\n')) {
        return format!("{open} {} {close}", out.join(", "));
    }
    let pad = " ".repeat(indent);
    format!(
        "{open}\n{pad}  {}\n{pad}{close}",
        out.join(&format!(",\n{pad}  "))
    )
}

fn key(k: &str) -> String {
    let ident = !k.is_empty()
        && k.chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == '$')
        && k.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
    if ident { k.to_owned() } else { quote(k) }
}

/// `strEscape`: single quotes unless the text contains one (then double quotes, then backticks).
fn quote(s: &str) -> String {
    let q = if !s.contains('\'') {
        '\''
    } else if !s.contains('"') {
        '"'
    } else if !s.contains('`') && !s.contains("${") {
        '`'
    } else {
        '\''
    };
    let mut out = String::with_capacity(s.len() + 2);
    out.push(q);
    for c in s.chars() {
        match c {
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\u{b}' => out.push_str("\\x0B"),
            '\\' => out.push_str("\\\\"),
            c if c == q && q == '\'' => out.push_str("\\'"),
            c if (c as u32) < 0x20 || (0x7f..=0x9f).contains(&(c as u32)) => {
                out.push_str(&format!("\\x{:02X}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push(q);
    out
}

/// A plain empty JavaScript object.
pub fn object() -> Obj {
    Obj::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn s(v: &str) -> Val {
        Val::Str(v.into())
    }
    #[test]
    fn inspect_matches_node() {
        let mut o = Obj::new();
        o.set("a", 1.);
        assert_eq!(inspect(&Val::Obj(o)), "{ a: 1 }");
        assert_eq!(inspect(&Val::Arr(vec![Val::Num(1.), s("x")])), "[ 1, 'x' ]");
        assert_eq!(inspect(&s("it's")), "\"it's\"");
        assert_eq!(inspect(&s("a\nb")), "'a\\nb'");
    }
    #[test]
    fn relational_and_tostring() {
        assert!(!greater(&s("10"), &s("9")));
        assert!(greater(&s("10"), &Val::Num(9.)));
        assert!(!greater(&Val::Undef, &Val::Num(1.)));
        assert!(!greater(&Val::Null, &Val::Num(0.)));
        assert_eq!(to_string(&Val::Arr(vec![Val::Null, Val::Num(1.)])), ",1");
    }
}
