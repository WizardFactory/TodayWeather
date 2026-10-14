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
