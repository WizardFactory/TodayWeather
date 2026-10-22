//! data.go.kr pages as the legacy collector receives them. server2 stores the JSON form
//! (`dataType=JSON`); legacy requested XML and read every field through xml2js as `item.x[0]`, so
//! each item field is the string form of its JSON value (`String(value)`). The page checks of
//! `CollectData._requestPage`/`_requestRemainingPages`/`getData` run again on the stored pages:
//! an acquisition legacy would have refused is never applied.
use crate::gateway::response::js_number;
use serde_json::Value;

/// One item; fields are read by name, so their order does not matter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item(pub Vec<(String, String)>);
impl Item {
    pub fn get(&self, k: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|(name, _)| name == k)
            .map(|(_, v)| v.as_str())
    }
    /// `rowKey(item)`: the identity without its value.
    fn row_key(&self) -> Vec<(String, String)> {
        let mut key: Vec<(String, String)> = self
            .0
            .iter()
            .filter(|(k, _)| k != "fcstValue" && k != "obsrValue")
            .cloned()
            .collect();
        key.sort();
        key
    }
}
/// `String(value)` of a JSON scalar; None for a value XML text cannot carry.
fn text(v: &Value) -> Option<String> {
    Some(match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => js_number(n.as_f64()?),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        Value::Array(_) | Value::Object(_) => return None,
    })
}
fn scalar(v: Option<&Value>) -> Option<String> {
    v.and_then(text)
}
struct Page {
    total: String,
    page_no: Option<String>,
    rows: Option<String>,
    items: Vec<Item>,
}
/// `_requestPage` checks on one parsed page.
fn page(bytes: &[u8]) -> Option<Page> {
    let v: Value = serde_json::from_slice(bytes).ok()?;
    let response = v.get("response")?;
    let header = response.get("header")?;
    if scalar(header.get("resultCode")).as_deref() != Some("00") {
        return None;
    }
    let body = response.get("body")?;
    let total = scalar(body.get("totalCount"))?;
    if total.is_empty()
        || !total.bytes().all(|b| b.is_ascii_digit())
        || total.parse::<f64>().ok()? <= 0.
    {
        return None;
    }
    let list = body.get("items")?.get("item")?;
    // xml2js turns a single element into a one-element list as well.
    let list: Vec<&Value> = match list {
        Value::Array(a) => a.iter().collect(),
        other => vec![other],
    };
    if list.is_empty() {
        return None;
    }
    let mut items = Vec::new();
    for item in list {
        let o = item.as_object()?;
        let mut fields = Vec::new();
        for (k, x) in o {
            fields.push((k.clone(), text(x)?));
        }
        items.push(Item(fields));
    }
    Some(Page {
        total,
        page_no: scalar(body.get("pageNo")),
        rows: scalar(body.get("numOfRows")),
        items,
    })
}
/// Legacy request size and page cap (`numOfRows=999`, `KMA_MAX_PAGES` 5).
const SIZE: usize = 999;
const MAX_PAGES: usize = 5;
/// Every item of an acquisition in page order, or None when legacy refuses the page set.
pub fn items(pages: &[&[u8]]) -> Option<Vec<Item>> {
    let first = page(pages.first()?)?;
    let total: usize = first.total.parse().ok()?;
    let number = |s: &Option<String>| s.as_deref().map(crate::world::js::string_to_number);
    let echoed = |p: &Page, n: usize| {
        number(&p.page_no).is_none_or(|x| x == n as f64)
            && number(&p.rows).is_none_or(|x| x == SIZE as f64)
    };
    let all = if first.items.len() >= total {
        first.items
    } else {
        if first.items.len() != SIZE || total.div_ceil(SIZE) > MAX_PAGES || !echoed(&first, 1) {
            return None;
        }
        let mut seen = std::collections::HashSet::new();
        let mut merged = Vec::new();
        for item in first.items {
            if !seen.insert(item.row_key()) {
                return None;
            }
            merged.push(item);
        }
        let mut n = 2;
        while merged.len() < total {
            let p = page(pages.get(n - 1)?)?;
            if p.total.parse::<usize>().ok()? != total
                || p.items.len() != SIZE.min(total - merged.len())
                || !echoed(&p, n)
            {
                return None;
            }
            for item in p.items {
                if !seen.insert(item.row_key()) {
                    return None;
                }
                merged.push(item);
            }
            n += 1;
        }
        merged
    };
    (all.len() == total).then_some(all)
}

/// Raw providers can include fields the typed organizer ignores (the pinned mid-ta item
/// has49). Keep the full scalar item for legacy duplicate identity. Materialized Row/Doc
/// fields have their separate32-field limit; all raw fields still enter the checked plan.
const RAW_ITEM_FIELDS: usize = 64;

/// Reserve one bounded comparison index without cloning any row-key fields. The complete
/// requested payload and allowance are charged before reserve; verify actual Vec capacity too.
fn index_scratch(
    length: usize,
    used: &mut usize,
    limit: usize,
) -> Result<Vec<usize>, crate::storage::Error> {
    use super::forecast_cache::{add, allocation, reserve, vector};
    use crate::storage::Error;
    if length > 4995 {
        return Err(Error::Capacity);
    }
    let requested = allocation(
        length
            .checked_mul(std::mem::size_of::<usize>())
            .ok_or(Error::Capacity)?,
    )?;
    let admitted = add(*used, requested)?;
    if admitted > limit {
        return Err(Error::Capacity);
    }
    *used = admitted;
    let mut index = Vec::new();
    reserve(&mut index, length)?;
    let actual = vector(&index)?;
    if actual > requested {
        let next = add(*used, actual - requested)?;
        if next > limit {
            return Err(Error::Capacity);
        }
        *used = next;
    }
    for i in 0..length {
        index.push(i);
    }
    Ok(index)
}
/// Items are already sorted by field name. Preserve every unknown field in the legacy identity.
fn row_key_cmp(a: &Item, b: &Item) -> std::cmp::Ordering {
    a.0.iter()
        .filter(|(k, _)| k != "fcstValue" && k != "obsrValue")
        .cmp(
            b.0.iter()
                .filter(|(k, _)| k != "fcstValue" && k != "obsrValue"),
        )
}

/// Cache-only JSON conversion. Every input-derived container/string is admitted before its
/// fallible growth; serde's input/escape scratch is bounded by the already-admitted raw page.
/// Compatibility callers above keep their historical Option API.
pub(super) fn bounded(pages: &[&[u8]]) -> Result<Option<Vec<Item>>, crate::storage::Error> {
    use super::forecast_cache::{PAGE_BYTES, PARSE_BYTES, add, copied, reserve};
    use crate::storage::Error;
    use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
    use std::fmt;
    #[derive(Debug)]
    enum Node {
        Null,
        Bool(bool),
        Num(f64),
        Str(String),
        Arr(Vec<Node>),
        Obj(Vec<(String, Node)>),
    }
    impl Node {
        fn get(&self, k: &str) -> Option<&Node> {
            if let Self::Obj(o) = self {
                o.iter().find(|(n, _)| n == k).map(|(_, v)| v)
            } else {
                None
            }
        }
        fn take(&mut self, k: &str) -> Option<Node> {
            if let Self::Obj(o) = self {
                o.iter_mut()
                    .find(|(n, _)| n == k)
                    .map(|(_, v)| std::mem::replace(v, Self::Null))
            } else {
                None
            }
        }
        fn into_scalar(self) -> Option<String> {
            Some(match self {
                Self::Str(s) => s,
                Self::Null => String::new(),
                Self::Bool(b) => b.to_string(),
                Self::Num(n) => js_number(n),
                _ => return None,
            })
        }
        fn scalar(&self) -> Result<Option<String>, Error> {
            Ok(Some(match self {
                Self::Str(s) => copied(s)?,
                Self::Null => String::new(),
                Self::Bool(b) => b.to_string(),
                Self::Num(n) => js_number(*n),
                _ => return Ok(None),
            }))
        }
    }
    #[derive(Default)]
    struct Plan {
        bytes: usize,
        nodes: usize,
        capacity: bool,
    }
    impl Plan {
        fn take(&mut self, n: usize) -> bool {
            match add(self.bytes, n) {
                Ok(next) if next <= PARSE_BYTES => {
                    self.bytes = next;
                    true
                }
                _ => {
                    self.capacity = true;
                    false
                }
            }
        }
    }
    struct Seed<'a> {
        plan: &'a mut Plan,
        depth: usize,
    }
    impl<'de> DeserializeSeed<'de> for Seed<'_> {
        type Value = Node;
        fn deserialize<D: serde::Deserializer<'de>>(self, d: D) -> Result<Node, D::Error> {
            self.plan.nodes += 1;
            if self.depth > 32
                || self.plan.nodes > 32768
                || !self.plan.take(std::mem::size_of::<Node>() + 64)
            {
                self.plan.capacity = true;
                return Err(serde::de::Error::custom("forecast shape capacity"));
            }
            d.deserialize_any(self)
        }
    }
    impl<'de> Visitor<'de> for Seed<'_> {
        type Value = Node;
        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str("bounded forecast JSON")
        }
        fn visit_unit<E: serde::de::Error>(self) -> Result<Node, E> {
            Ok(Node::Null)
        }
        fn visit_bool<E: serde::de::Error>(self, b: bool) -> Result<Node, E> {
            Ok(Node::Bool(b))
        }
        fn visit_i64<E: serde::de::Error>(self, n: i64) -> Result<Node, E> {
            Ok(Node::Num(n as f64))
        }
        fn visit_u64<E: serde::de::Error>(self, n: u64) -> Result<Node, E> {
            Ok(Node::Num(n as f64))
        }
        fn visit_f64<E: serde::de::Error>(self, n: f64) -> Result<Node, E> {
            Ok(Node::Num(n))
        }
        fn visit_str<E: serde::de::Error>(self, s: &str) -> Result<Node, E> {
            if !self.plan.take(s.len() + 64) {
                return Err(E::custom("forecast string capacity"));
            }
            copied(s).map(Node::Str).map_err(|e| {
                self.plan.capacity = true;
                E::custom(e)
            })
        }
        fn visit_string<E: serde::de::Error>(self, s: String) -> Result<Node, E> {
            self.visit_str(&s)
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Node, A::Error> {
            let mut out = Vec::new();
            loop {
                let next = a.next_element_seed(Seed {
                    plan: self.plan,
                    depth: self.depth + 1,
                })?;
                let Some(v) = next else { break };
                if out.len() >= 4995 || !self.plan.take(std::mem::size_of::<Node>() + 64) {
                    self.plan.capacity = true;
                    return Err(serde::de::Error::custom("forecast array capacity"));
                }
                reserve(&mut out, 1).map_err(|e| {
                    self.plan.capacity = true;
                    serde::de::Error::custom(e)
                })?;
                out.push(v);
            }
            Ok(Node::Arr(out))
        }
        fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Node, A::Error> {
            let mut out: Vec<(String, Node)> = Vec::new();
            while let Some(k) = a.next_key_seed(Seed {
                plan: self.plan,
                depth: self.depth + 1,
            })? {
                let Node::Str(k) = k else {
                    return Err(serde::de::Error::custom("forecast field"));
                };
                if !self.plan.take(std::mem::size_of::<(String, Node)>() + 64) {
                    self.plan.capacity = true;
                    return Err(serde::de::Error::custom("forecast field capacity"));
                }
                let v = a.next_value_seed(Seed {
                    plan: self.plan,
                    depth: self.depth + 1,
                })?;
                if let Some((_, old)) = out.iter_mut().find(|(name, _)| name == &k) {
                    *old = v;
                } else {
                    reserve(&mut out, 1).map_err(|e| {
                        self.plan.capacity = true;
                        serde::de::Error::custom(e)
                    })?;
                    out.push((k, v));
                }
            }
            Ok(Node::Obj(out))
        }
    }
    let mut plan = Plan::default();
    let mut parsed = Vec::new();
    if pages.is_empty() {
        return Ok(None);
    }
    let mut declared = None;
    let mut read_items = 0usize;
    for bytes in pages.iter().take(5) {
        plan.nodes = 0;
        if bytes.len() > PAGE_BYTES
            || !plan.take(bytes.len().checked_mul(2).ok_or(Error::Capacity)?)
        {
            return Err(Error::Capacity);
        }
        let mut d = serde_json::Deserializer::from_slice(bytes);
        let mut node = match (Seed {
            plan: &mut plan,
            depth: 1,
        })
        .deserialize(&mut d)
        {
            Ok(node) if d.end().is_ok() => node,
            _ if plan.capacity => return Err(Error::Capacity),
            _ => return Ok(None),
        };
        let Some(response) = node.get("response") else {
            return Ok(None);
        };
        if response
            .get("header")
            .and_then(|h| h.get("resultCode"))
            .map(Node::scalar)
            .transpose()?
            .flatten()
            .as_deref()
            != Some("00")
        {
            return Ok(None);
        }
        let Some(mut body) = node.take("response").and_then(|mut r| r.take("body")) else {
            return Ok(None);
        };
        let Some(total) = body
            .get("totalCount")
            .map(Node::scalar)
            .transpose()?
            .flatten()
        else {
            return Ok(None);
        };
        if total.is_empty() || !total.bytes().all(|c| c.is_ascii_digit()) {
            return Ok(None);
        }
        let Ok(total) = total.parse::<usize>() else {
            return Ok(None);
        };
        if total == 0 {
            return Ok(None);
        };
        if total > 4995 {
            return Err(Error::Capacity);
        }
        let Some(list) = body.take("items").and_then(|mut i| i.take("item")) else {
            return Ok(None);
        };
        let (mut many, mut one) = match list {
            Node::Arr(a) => (Some(a.into_iter()), None),
            other => (None, Some(other)),
        };
        let count = many.as_ref().map_or(1, ExactSizeIterator::len);
        let mut converted = Vec::new();
        reserve(&mut converted, count)?;
        for item in std::iter::from_fn(|| match &mut many {
            Some(a) => a.next(),
            None => one.take(),
        }) {
            let Node::Obj(fields) = item else {
                return Ok(None);
            };
            if fields.len() > RAW_ITEM_FIELDS {
                return Err(Error::Capacity);
            }
            if !plan.take(
                fields
                    .len()
                    .checked_mul(std::mem::size_of::<(String, String)>() + 64)
                    .ok_or(Error::Capacity)?,
            ) {
                return Err(Error::Capacity);
            }
            let mut out = Vec::new();
            reserve(&mut out, fields.len())?;
            for (k, v) in fields {
                if !plan.take(
                    k.len()
                        + 64
                        + match &v {
                            Node::Str(s) => s.len(),
                            _ => 32,
                        },
                ) {
                    return Err(Error::Capacity);
                }
                let Some(value) = v.into_scalar() else {
                    return Ok(None);
                };
                out.push((k, value));
            }
            out.sort_by(|a, b| a.0.cmp(&b.0));
            converted.push(Item(out));
        }
        if converted.is_empty() {
            return Ok(None);
        }
        if declared.is_none() {
            if converted.len() >= total {
                return Ok((converted.len() == total).then_some(converted));
            }
            declared = Some(total);
        }
        read_items = add(read_items, converted.len())?;
        let scalar = |name| -> Result<Option<f64>, Error> {
            Ok(body
                .get(name)
                .map(Node::scalar)
                .transpose()?
                .flatten()
                .map(|s| crate::world::js::string_to_number(&s)))
        };
        reserve(&mut parsed, 1)?;
        parsed.push((total, scalar("pageNo")?, scalar("numOfRows")?, converted));
        if read_items >= declared.unwrap_or(total) {
            break;
        }
    }
    let (total, page_no, rows, first) = parsed.remove(0);
    if first.len() >= total {
        return Ok((first.len() == total).then_some(first));
    }
    let echoed = |p: Option<f64>, r: Option<f64>, n: usize| {
        p.is_none_or(|p| p == n as f64) && r.is_none_or(|r| r == 999.)
    };
    if first.len() != 999 || total.div_ceil(999) > 5 || !echoed(page_no, rows, 1) {
        return Ok(None);
    }
    let mut out = Vec::new();
    reserve(&mut out, total)?;
    let mut chunks = std::iter::once((total, page_no, rows, first)).chain(parsed);
    let mut n = 1;
    while out.len() < total {
        let Some((t, p, r, items)) = chunks.next() else {
            return Ok(None);
        };
        if t != total || items.len() != 999.min(total - out.len()) || !echoed(p, r, n) {
            return Ok(None);
        }
        out.extend(items);
        n += 1;
    }
    // Validate a sorted index, leaving page/item order unchanged. Comparison borrows full
    // row keys and is O(N log N), rather than repeatedly scanning every previous item.
    let mut index = index_scratch(out.len(), &mut plan.bytes, PARSE_BYTES)?;
    index.sort_unstable_by(|a, b| row_key_cmp(&out[*a], &out[*b]));
    if index
        .windows(2)
        .any(|pair| row_key_cmp(&out[pair[0]], &out[pair[1]]).is_eq())
    {
        return Ok(None);
    }
    Ok(Some(out))
}

#[cfg(test)]
mod bounded_tests {
    use super::*;
    fn page(start: usize, count: usize, total: usize, number: usize) -> Vec<u8> {
        let items:Vec<_>=(start..start+count).map(|i|serde_json::json!({"baseDate":"20260924","baseTime":"1000","category":format!("ROW{i}"),"nx":60,"ny":127,"fcstDate":"20260924","fcstTime":"1100","fcstValue":"1"})).collect();
        serde_json::to_vec(&serde_json::json!({"response":{"header":{"resultCode":"00"},"body":{"totalCount":total,"pageNo":number,"numOfRows":999,"items":{"item":items}}}})).unwrap()
    }
    #[test]
    fn index_scratch_is_precharged_at_exact_capacity_boundaries() {
        let length = 4995;
        let charge =
            super::super::forecast_cache::allocation(length * std::mem::size_of::<usize>())
                .unwrap();
        let base = 17;
        for extra in [-1isize, 0, 1] {
            let mut used = base;
            let result = index_scratch(
                length,
                &mut used,
                (base + charge).checked_add_signed(extra).unwrap(),
            );
            if extra < 0 {
                assert!(matches!(result, Err(crate::storage::Error::Capacity)));
                assert_eq!(used, base);
            } else {
                let index = result.unwrap();
                assert_eq!(index.len(), length);
                assert_eq!(
                    index.capacity(),
                    length,
                    "recorded requested capacity must not silently grow"
                );
                assert_eq!(
                    used,
                    base + super::super::forecast_cache::vector(&index).unwrap()
                );
                assert_eq!(index[0], 0);
                assert_eq!(index[length - 1], length - 1);
            }
        }
        let mut used = base;
        assert!(matches!(
            index_scratch(4996, &mut used, usize::MAX),
            Err(crate::storage::Error::Capacity)
        ));
        assert_eq!(used, base);
    }
    #[test]
    fn multi_page_duplicate_identity_excludes_both_value_fields() {
        for same_page in [false, true] {
            let mut first: Value = serde_json::from_slice(&page(0, 999, 1000, 1)).unwrap();
            let mut second: Value = serde_json::from_slice(&page(999, 1, 1000, 2)).unwrap();
            let mut duplicate = first["response"]["body"]["items"]["item"][0].clone();
            duplicate["fcstValue"] = Value::String("different forecast value".into());
            duplicate["obsrValue"] = Value::String("different observation value".into());
            if same_page {
                first["response"]["body"]["items"]["item"][1] = duplicate;
            } else {
                second["response"]["body"]["items"]["item"][0] = duplicate;
            }
            let bytes = [
                serde_json::to_vec(&first).unwrap(),
                serde_json::to_vec(&second).unwrap(),
            ];
            let refs = [bytes[0].as_slice(), bytes[1].as_slice()];
            assert_eq!(items(&refs), None);
            assert_eq!(bounded(&refs).unwrap(), None);
        }
    }
    #[test]
    fn unknown_fields_decide_identity_and_multi_page_order_remains_original() {
        let mut first: Value = serde_json::from_slice(&page(0, 999, 1000, 1)).unwrap();
        let mut second: Value = serde_json::from_slice(&page(999, 1, 1000, 2)).unwrap();
        first["response"]["body"]["items"]["item"][0]["providerExtra"] =
            Value::String("first".into());
        let mut other = first["response"]["body"]["items"]["item"][0].clone();
        other["providerExtra"] = Value::String("second".into());
        second["response"]["body"]["items"]["item"][0] = other;
        first["response"]["body"]["items"]["item"]
            .as_array_mut()
            .unwrap()
            .reverse();
        let bytes = [
            serde_json::to_vec(&first).unwrap(),
            serde_json::to_vec(&second).unwrap(),
        ];
        let refs = [bytes[0].as_slice(), bytes[1].as_slice()];
        let actual = bounded(&refs).unwrap().unwrap();
        assert_eq!(Some(actual.clone()), items(&refs));
        assert_eq!(actual.len(), 1000);
        assert_eq!(actual[0].get("category"), Some("ROW998"));
        assert_eq!(actual[998].get("providerExtra"), Some("first"));
        assert_eq!(actual[999].get("providerExtra"), Some("second"));
        assert!(
            actual
                .iter()
                .all(|item| item.0.windows(2).all(|pair| pair[0].0 < pair[1].0))
        );
    }
    #[test]
    fn complete_first_page_does_not_add_multi_page_duplicate_validation() {
        let mut first: Value = serde_json::from_slice(&page(0, 2, 2, 1)).unwrap();
        first["response"]["body"]["items"]["item"][1] =
            first["response"]["body"]["items"]["item"][0].clone();
        let bytes = serde_json::to_vec(&first).unwrap();
        let refs = [bytes.as_slice(), b"ignored invalid second page".as_slice()];
        assert_eq!(bounded(&refs).unwrap(), items(&refs));
        assert_eq!(bounded(&refs).unwrap().unwrap().len(), 2);
    }
    #[test]
    fn pinned_mid49_fields_are_preserved_without_early_projection() {
        use std::io::Read;
        let mut bytes = Vec::new();
        flate2::read::GzDecoder::new(
            &include_bytes!("../../../../tests/domestic/fixtures/source.json.gz")[..],
        )
        .read_to_end(&mut bytes)
        .unwrap();
        let fixture: Value = serde_json::from_slice(&bytes).unwrap();
        let mut checked = 0;
        for scenario in fixture["mid"].as_array().unwrap() {
            for run in scenario["runs"].as_array().unwrap() {
                if run["kind"] != "temp" {
                    continue;
                }
                let pages: Vec<_> = run["pages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| p.as_str().unwrap().as_bytes())
                    .collect();
                let old = items(&pages).unwrap();
                assert_eq!(old[0].0.len(), 49);
                let actual = bounded(&pages).unwrap().unwrap();
                assert_eq!(actual, old);
                assert!(actual[0].get("taMin3Low").is_some());
                checked += 1;
            }
        }
        assert_eq!(checked, 3);
    }
    #[test]
    fn raw_item64_fields_fit_but65_are_refused_without_changing_canonical_limit() {
        for fields in [64, 65] {
            let item: serde_json::Map<String, Value> = (0..fields)
                .map(|n| (format!("unknown{n}"), Value::String(n.to_string())))
                .collect();
            let bytes = serde_json::to_vec(&serde_json::json!({"response":{"header":{"resultCode":"00"},"body":{"totalCount":1,"items":{"item":[item]}}}})).unwrap();
            assert!(bytes.len() < super::super::forecast_cache::PAGE_BYTES);
            let refs = [bytes.as_slice()];
            assert_eq!(items(&refs).unwrap()[0].0.len(), fields);
            if fields == 64 {
                let actual = bounded(&refs).unwrap().unwrap();
                assert_eq!(actual, items(&refs).unwrap());
                assert_eq!(actual[0].0.len(), 64);
            } else {
                assert!(matches!(
                    bounded(&refs),
                    Err(crate::storage::Error::Capacity)
                ));
            }
        }
    }
    #[test]
    fn node_bound_is_per_page_while_acquisition_merge_preserves_all1998_items() {
        let first = page(0, 999, 1998, 1);
        let second = page(999, 999, 1998, 2);
        let refs = [first.as_slice(), second.as_slice()];
        let actual = bounded(&refs).unwrap().unwrap();
        assert_eq!(actual.len(), 1998);
        assert_eq!(Some(actual), items(&refs));
    }
    #[test]
    fn complete_first_page_keeps_legacy_ignored_extra_pages_contract() {
        let first = page(0, 1, 1, 1);
        let refs = [
            first.as_slice(),
            b"invalid ignored page",
            b"x",
            b"x",
            b"x",
            b"x",
        ];
        assert_eq!(bounded(&refs).unwrap(), items(&refs));
        assert_eq!(bounded(&refs).unwrap().unwrap().len(), 1);
    }
}

#[cfg(test)]
mod structural_parser_contract_tests {
    use super::*;
    #[test]
    fn structural_parser_scalars_escapes_unknown_fields_and_duplicate_json_keys() {
        let scalars = [
            r#""plain""#,
            r#""line\nwith\"escape""#,
            "null",
            "true",
            "-0",
            "1.234567890123456e40",
            r#""\uD83D\uDE00""#,
        ];
        for scalar in scalars {
            let raw = format!(
                r#"{{"response":{{"header":{{"resultCode":"00"}},"body":{{"totalCount":1,"pageNo":1,"numOfRows":999,"items":{{"item":[{{"category":"old","category":"T1H","baseDate":"20260924","providerExtra":{scalar},"fcstValue":{scalar}}}]}}}}}}}}"#
            );
            let refs = [raw.as_bytes()];
            assert_eq!(bounded(&refs).unwrap(), items(&refs), "{scalar}");
        }
        for raw in [
            b"{invalid".as_slice(),
            br#"{"response":{"header":{"resultCode":"99"}}}"#.as_slice(),
        ] {
            assert_eq!(bounded(&[raw]).unwrap(), items(&[raw]));
        }
    }
}
