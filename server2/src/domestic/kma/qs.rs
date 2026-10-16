//! `req.query` of the legacy Express 4.13.4 app: `qs` 4.0.0 `parse` with Express's options
//! (`lib/utils.js` `parseExtendedQueryString`: `allowDots: false`, `allowPrototypes: true`; qs
//! defaults: depth 5, arrayLimit 20, parameterLimit 1000), ported over the KMA value layer
//! ([`super::js::V`]). The port follows `qs/lib/parse.js` and `qs/lib/utils.js` (`merge`,
//! `arrayToObject`, `decode`, `compact`) step by step, including JavaScript's `__proto__`
//! assignment (an object value becomes the prototype, any other value is ignored).
//!
//! Ported from qs 4.0.0. Copyright (c) 2014 Nathan LaFreniere and other contributors. All rights
//! reserved.
//!
//! Redistribution and use in source and binary forms, with or without modification, are
//! permitted provided that the following conditions are met:
//! * Redistributions of source code must retain the above copyright notice, this list of
//!   conditions and the following disclaimer.
//! * Redistributions in binary form must reproduce the above copyright notice, this list of
//!   conditions and the following disclaimer in the documentation and/or other materials
//!   provided with the distribution.
//! * The names of any contributors may not be used to endorse or promote products derived from
//!   this software without specific prior written permission.
//!
//! THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS
//! OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
//! MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
//! COPYRIGHT HOLDERS AND CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
//! EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE
//! GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
//! ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
//! NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
//! OF THE POSSIBILITY OF SUCH DAMAGE.
use super::js::{Arr, Ob, V, canon_str};

const DEPTH: usize = 5;
const ARRAY_LIMIT: i64 = 20;
const PARAMETER_LIMIT: usize = 1000;

/// `qs.parse(str, {allowDots: false, allowPrototypes: true})`.
pub fn parse(raw: &str) -> V {
    let obj = Ob::new();
    if raw.is_empty() {
        return V::Obj(obj);
    }
    let temp = parse_values(raw);
    let mut out = V::Obj(obj);
    for (key, value) in temp.entries() {
        if let Some(new) = parse_keys(&key, value) {
            out = merge(out, new);
        }
    }
    compact(out)
}

/// `Utils.decode`: `+` as space, then `decodeURIComponent`, or the input when that throws.
fn decode(s: &str) -> String {
    canon_str(
        &super::js::decode_uri_component(&s.replace('+', " ")).unwrap_or_else(|| s.to_owned()),
    )
}

/// `internals.parseValues`.
fn parse_values(raw: &str) -> Ob {
    let obj = Ob::new();
    for part in raw.split('&').take(PARAMETER_LIMIT) {
        let pos = match part.find("]=") {
            Some(i) => Some(i + 1),
            None => part.find('='),
        };
        match pos {
            None => assign(&obj, &decode(part), V::from(String::new())),
            Some(pos) => {
                let key = decode(&part[..pos]);
                let val = V::from(decode(&part[pos + 1..]));
                if !obj.has(&key) {
                    assign(&obj, &key, val);
                } else {
                    let mut items = concat_items(&obj.get(&key));
                    items.extend(concat_items(&val));
                    assign(&obj, &key, V::Arr(Arr::from_vec(items)));
                }
            }
        }
    }
    obj
}

/// `obj[key] = value` on an ordinary object: `__proto__` is the prototype setter.
fn assign(obj: &Ob, key: &str, value: V) {
    if key == "__proto__" {
        match value {
            V::Obj(proto) => obj.set_proto(Some(proto)),
            V::Arr(a) => obj.set_proto(Some(a.as_object())),
            V::Null => obj.set_proto(None),
            _ => {}
        }
    } else {
        obj.set(key, value);
    }
}

/// The elements `[].concat(v)` contributes: an array's elements (holes as undefined), or `v`.
fn concat_items(v: &V) -> Vec<V> {
    match v {
        V::Arr(a) => a.items(),
        other => vec![other.clone()],
    }
}

/// `internals.parseKeys` (None: no key, `undefined`).
fn parse_keys(key: &str, val: V) -> Option<V> {
    if key.is_empty() {
        return None;
    }
    // `/^([^\[\]]*)/`: the parent up to the first bracket.
    let parent_end = key.find(['[', ']']).unwrap_or(key.len());
    let mut keys: Vec<String> = Vec::new();
    if parent_end > 0 {
        keys.push(key[..parent_end].to_owned());
    }
    // `/(\[[^\[\]]*\])/g` from the start of the key, at most `depth` children.
    let mut found = 0;
    let mut at = 0;
    let mut rest: Option<usize> = None;
    while let Some((start, end)) = next_child(key, at) {
        if found >= DEPTH {
            rest = Some(start);
            break;
        }
        found += 1;
        keys.push(key[start..end].to_owned());
        at = end;
    }
    if let Some(start) = rest {
        keys.push(format!("[{}]", &key[start..]));
    }
    Some(parse_object(&keys, val))
}

/// The next `[...]` without inner brackets at or after byte `from`: (start, end).
fn next_child(key: &str, from: usize) -> Option<(usize, usize)> {
    let bytes = key.as_bytes();
    let mut i = from;
    while i < bytes.len() {
        if bytes[i] == b'[' {
            let mut j = i + 1;
            while j < bytes.len() && bytes[j] != b'[' && bytes[j] != b']' {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b']' {
                return Some((i, j + 1));
            }
            // `[` followed by another `[` (or nothing): the match starts later.
            i = j;
            continue;
        }
        i += 1;
    }
    None
}

/// `internals.parseObject`.
fn parse_object(chain: &[String], val: V) -> V {
    let Some((root, rest)) = chain.split_first() else {
        return val;
    };
    if root == "[]" {
        return V::Arr(Arr::from_vec(concat_items(&parse_object(rest, val))));
    }
    let clean = if root.starts_with('[') && root.ends_with(']') && root.len() >= 2 {
        &root[1..root.len() - 1]
    } else {
        root.as_str()
    };
    // `parseInt(cleanRoot, 10)` whose string form is `cleanRoot`, in `0..=arrayLimit`, and only
    // for a bracketed root.
    let index = canonical_index(clean).filter(|i| (0..=ARRAY_LIMIT).contains(i));
    match index {
        Some(i) if root != clean => {
            let a = Arr::from_vec(Vec::new());
            a.put(i as usize, parse_object(rest, val));
            V::Arr(a)
        }
        _ => {
            let obj = Ob::new();
            assign(&obj, clean, parse_object(rest, val));
            V::Obj(obj)
        }
    }
}

/// A key equal to `'' + parseInt(key, 10)` (a canonical decimal integer).
fn canonical_index(s: &str) -> Option<i64> {
    let digits = s.strip_prefix('-').unwrap_or(s);
    if digits.is_empty()
        || !digits.bytes().all(|b| b.is_ascii_digit())
        || (digits.len() > 1 && digits.starts_with('0'))
        || s == "-0"
        || digits.len() > 15
    {
        return None;
    }
    s.parse().ok()
}

/// `Utils.merge(target, source)`.
fn merge(target: V, source: V) -> V {
    if !source.truthy() {
        return target;
    }
    match &source {
        V::Obj(_) | V::Arr(_) => {}
        // A string source.
        _ => {
            return match target {
                V::Arr(a) => {
                    a.push(source);
                    V::Arr(a)
                }
                V::Obj(o) => {
                    o.set(&super::js::to_str(&source), V::Bool(true));
                    V::Obj(o)
                }
                other => V::Arr(Arr::from_vec(vec![other, source])),
            };
        }
    }
    let target = match target {
        V::Obj(o) => V::Obj(o),
        V::Arr(a) => {
            if matches!(source, V::Arr(_)) {
                V::Arr(a)
            } else {
                V::Obj(array_to_object(&a))
            }
        }
        // `[target].concat(source)`.
        other => {
            let mut items = vec![other];
            items.extend(concat_items(&source));
            return V::Arr(Arr::from_vec(items));
        }
    };
    for (key, value) in own_entries(&source) {
        let existing = own_get(&target, &key);
        let merged = match existing {
            None => value,
            Some(old) => merge(old, value),
        };
        own_set(&target, &key, merged);
    }
    target
}

/// `Object.keys(source)` with values: object own keys, or an array's defined indices.
fn own_entries(v: &V) -> Vec<(String, V)> {
    match v {
        V::Obj(o) => o.entries(),
        V::Arr(a) => a
            .items()
            .into_iter()
            .enumerate()
            .filter(|(_, x)| !matches!(x, V::Undef))
            .map(|(i, x)| (i.to_string(), x))
            .collect(),
        _ => Vec::new(),
    }
}
/// `hasOwnProperty.call(target, key) ? target[key] : none`.
fn own_get(target: &V, key: &str) -> Option<V> {
    match target {
        V::Obj(o) => o.has(key).then(|| o.get(key)),
        V::Arr(a) => key
            .parse::<usize>()
            .ok()
            .filter(|i| i.to_string() == key)
            .and_then(|i| a.items().get(i).cloned())
            .filter(|x| !matches!(x, V::Undef)),
        _ => None,
    }
}
/// `target[key] = value`.
fn own_set(target: &V, key: &str, value: V) {
    match target {
        V::Obj(o) => assign(o, key, value),
        V::Arr(a) => {
            if let Some(i) = key.parse::<usize>().ok().filter(|i| i.to_string() == key) {
                a.put(i, value);
            }
        }
        _ => {}
    }
}

/// `Utils.arrayToObject`: defined elements by index.
fn array_to_object(a: &Arr) -> Ob {
    let obj = Ob::new();
    for (i, x) in a.items().into_iter().enumerate() {
        if !matches!(x, V::Undef) {
            obj.set(&i.to_string(), x);
        }
    }
    obj
}

/// `Utils.compact`: arrays lose their holes (elements are not compacted further); objects
/// compact each property.
fn compact(v: V) -> V {
    match v {
        V::Arr(a) => V::Arr(Arr::from_vec(
            a.items()
                .into_iter()
                .filter(|x| !matches!(x, V::Undef))
                .collect(),
        )),
        V::Obj(o) => {
            for (k, x) in o.entries() {
                o.set(&k, compact(x));
            }
            V::Obj(o)
        }
        other => other,
    }
}
