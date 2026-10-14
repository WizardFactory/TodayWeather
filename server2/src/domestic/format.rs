//! Raw-format inspection before persistence. Pure and bounded by the caller's body cap.
//! data.go.kr rules: collectTownForecast `_requestPage`/`_requestRemainingPages`,
//! forecastGridCollection identities, midForecastPolicy, lifeIndexKmaRequester page checks.
//! KMA web rules: TownRss.parseShortRss, KmaScraper `_parseStnMinInfo`, `_decodeKmaHtml`,
//! `_parseCityWeatherHtml` (ca8735cf). Nothing here normalizes or stores weather values.
use super::family::{DataGoKrFamily, DataGoKrRequest, Shape, Target, WebFamily, WebRequest};
use super::publication::Publication;
use serde_json::{Map, Value};
use std::collections::BTreeSet;

/// Page-1 facts that later pages must repeat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Expect {
    pub total: u32,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageReport {
    pub total: u32,
    pub rows: u32,
    /// Canonical publication of this page (echo, issuance or requested tmFc).
    pub publication: Publication,
    /// Row identities used to reject duplicates across pages.
    pub row_keys: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PageVerdict {
    Valid(PageReport),
    /// `03`, or `00` with no rows: the publication is not available yet.
    NotPublished,
    /// Every row echoes another publication (legacy previousPublication).
    Stale(Publication),
    /// Life-index terminal no data (`03`/`99`).
    NoData,
    Invalid(&'static str),
}
fn number(v: &Value) -> Option<u64> {
    match v {
        Value::Number(n) => n.as_u64(),
        Value::String(s)
            if (1..=10).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit()) =>
        {
            s.parse().ok()
        }
        _ => None,
    }
}
fn text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.trim().to_owned()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}
fn canonical_without(row: &Map<String, Value>, drop: &[&str]) -> String {
    let mut copy = row.clone();
    for key in drop {
        copy.remove(*key);
    }
    Value::Object(copy).to_string()
}

pub fn inspect_page(
    request: &DataGoKrRequest,
    page: u32,
    expect: Option<Expect>,
    json: &Value,
) -> PageVerdict {
    let shape = request.family().shape();
    let empty = || match (page, shape) {
        (1, Shape::Life) => PageVerdict::NoData,
        (1, _) => PageVerdict::NotPublished,
        _ => PageVerdict::Invalid("empty later page"),
    };
    let Some(response) = json.get("response").and_then(Value::as_object) else {
        return PageVerdict::Invalid("envelope");
    };
    let Some(code) = response
        .get("header")
        .and_then(|h| h.get("resultCode"))
        .and_then(text)
    else {
        return PageVerdict::Invalid("result code");
    };
    match (code.as_str(), shape) {
        ("00" | "0", _) => {}
        ("03", _) | ("99", Shape::Life) => return empty(),
        _ => return PageVerdict::Invalid("result code"),
    }
    let Some(body) = response.get("body").and_then(Value::as_object) else {
        return PageVerdict::Invalid("body");
    };
    let items: Vec<&Map<String, Value>> = match body.get("items") {
        None | Some(Value::Null) => return empty(),
        Some(Value::String(s)) if s.is_empty() => return empty(),
        Some(items) => match items.get("item") {
            None | Some(Value::Null) => return empty(),
            Some(Value::String(s)) if s.is_empty() => return empty(),
            Some(Value::Array(list)) => {
                let mut rows = Vec::with_capacity(list.len());
                for row in list {
                    let Some(object) = row.as_object() else {
                        return PageVerdict::Invalid("item");
                    };
                    rows.push(object);
                }
                rows
            }
            Some(Value::Object(one)) => vec![one],
            Some(_) => return PageVerdict::Invalid("items"),
        },
    };
    let Some(total) = body.get("totalCount").and_then(number) else {
        return PageVerdict::Invalid("totalCount");
    };
    if items.is_empty() || total == 0 {
        return empty();
    }
    let per = u64::from(request.family().rows());
    let rows = items.len() as u64;
    // Page identity is mandatory whenever completeness depends on it (any multi-page set)
    // and always for the life index (legacy `_validatePollenPageV3`); a single forecast
    // page may omit it as legacy `_requestPage` allowed.
    let paged = page > 1 || rows != total || shape == Shape::Life;
    let echo = |name: &str, wanted: u64| match body.get(name) {
        Some(v) => number(v) == Some(wanted),
        None => !paged,
    };
    if page == 0
        || !echo("numOfRows", per)
        || !echo("pageNo", u64::from(page))
        || total > u64::from(u32::MAX)
        || expect.is_some_and(|e| u64::from(e.total) != total)
    {
        return PageVerdict::Invalid("page echo or total");
    }
    let before = per * u64::from(page - 1);
    let expected = if page == 1 && rows == total {
        total
    } else if total > before {
        per.min(total - before)
    } else {
        return PageVerdict::Invalid("page beyond total");
    };
    if rows != expected {
        return PageVerdict::Invalid("row count");
    }
    let mut keys = BTreeSet::new();
    let mut row_keys = Vec::with_capacity(items.len());
    let publication = match shape {
        Shape::Town => {
            let Target::Grid { nx, ny } = request.target() else {
                return PageVerdict::Invalid("target");
            };
            let current = request.family() == DataGoKrFamily::UltraSrtNcst;
            let value = if current { "obsrValue" } else { "fcstValue" };
            let digits = |v: Option<String>, n: usize| {
                v.is_some_and(|v| v.len() == n && v.bytes().all(|b| b.is_ascii_digit()))
            };
            let mut echo: Option<Publication> = None;
            for row in &items {
                let (Some(date), Some(time)) = (
                    row.get("baseDate").and_then(text),
                    row.get("baseTime").and_then(text),
                ) else {
                    return PageVerdict::Invalid("base echo");
                };
                let Some(p) = Publication::parse_compact(&format!("{date}{time}")) else {
                    return PageVerdict::Invalid("base echo");
                };
                // Ultra-short is answered as HH00 or HH30 only (#2676); other minutes are not
                // an accepted publication form.
                if echo.is_some_and(|e| e != p)
                    || (request.family() == DataGoKrFamily::UltraSrtFcst
                        && !matches!(p.minute(), 0 | 30))
                {
                    return PageVerdict::Invalid("base echo");
                }
                echo = Some(p);
                if row.get("nx").and_then(number) != Some(u64::from(*nx))
                    || row.get("ny").and_then(number) != Some(u64::from(*ny))
                    || !row
                        .get("category")
                        .and_then(Value::as_str)
                        .is_some_and(|c| !c.is_empty())
                    || row.get(value).and_then(text).is_none()
                    || (!current
                        && !(digits(row.get("fcstDate").and_then(text), 8)
                            && digits(row.get("fcstTime").and_then(text), 4)))
                {
                    return PageVerdict::Invalid("forecast row");
                }
                let key = canonical_without(row, &["fcstValue", "obsrValue"]);
                if !keys.insert(key.clone()) {
                    return PageVerdict::Invalid("duplicate row");
                }
                row_keys.push(key);
            }
            let Some(echo) = echo else {
                return PageVerdict::Invalid("base echo");
            };
            match request.echo(echo) {
                (true, canonical) => canonical,
                (false, other) => return PageVerdict::Stale(other),
            }
        }
        Shape::Mid => {
            for row in &items {
                let fields = |prefixes: &[&str]| {
                    row.iter().any(|(k, v)| {
                        prefixes.iter().any(|p| k.starts_with(p)) && text(v).is_some()
                    })
                };
                let id_ok = match request.target() {
                    Target::Region(c) => row
                        .get("regId")
                        .is_none_or(|v| text(v).as_deref() == Some(c.as_str())),
                    Target::Station(c) => row
                        .get("stnId")
                        .is_none_or(|v| text(v).as_deref() == Some(c.as_str())),
                    _ => false,
                };
                let content = match request.family() {
                    DataGoKrFamily::MidFcst => fields(&["wfSv"]),
                    DataGoKrFamily::MidLandFcst => fields(&["wf", "rnSt"]),
                    DataGoKrFamily::MidTa => fields(&["taMin", "taMax"]),
                    _ => fields(&["wf", "wh"]),
                };
                if !id_ok || !content {
                    return PageVerdict::Invalid("mid row");
                }
                let key = canonical_without(row, &[]);
                if !keys.insert(key.clone()) {
                    return PageVerdict::Invalid("duplicate row");
                }
                row_keys.push(key);
            }
            request.publication()
        }
        Shape::Life => {
            // UV rows carry hourly `hN` values; pollen rows carry daily grades. A response of
            // the other index family is not this request's data.
            // Index fields must be scalars (an empty string is the provider's "no value");
            // a row needs at least one numeric index value to be index data at all.
            let uv = request.family() == DataGoKrFamily::UvIdxV5;
            let index_field = |k: &str| {
                if uv {
                    k.len() > 1 && k.starts_with('h') && k[1..].bytes().all(|b| b.is_ascii_digit())
                } else {
                    // The real V3 response carries day+3 as `twodaysaftertomorrow` (AK A-2,
                    // 2026-10-14); legacy reads the absent `todaysaftertomorrow`, kept here too.
                    matches!(
                        k,
                        "today"
                            | "tomorrow"
                            | "dayaftertomorrow"
                            | "twodaysaftertomorrow"
                            | "todaysaftertomorrow"
                            | "theDayAfterTomorrow"
                    )
                }
            };
            let content = |row: &Map<String, Value>| {
                let mut numeric = false;
                for (_, v) in row.iter().filter(|(k, _)| index_field(k)) {
                    // Legacy converters omit empty or malformed strings; null/object/array
                    // are not a provider value form.
                    match v {
                        Value::Number(_) => numeric = true,
                        Value::String(s) => {
                            let s = s.trim();
                            // Legacy converters use `Number(raw)` after rejecting empty text.
                            numeric |= !s.is_empty() && s.parse::<f64>().is_ok_and(f64::is_finite);
                        }
                        _ => return false,
                    }
                }
                numeric
            };
            let mut issuance: Option<String> = None;
            for row in &items {
                if !content(row) {
                    return PageVerdict::Invalid("life row");
                }
                let (Some(area), Some(date)) = (
                    row.get("areaNo").and_then(text),
                    row.get("date").and_then(text),
                ) else {
                    return PageVerdict::Invalid("life row");
                };
                if area.is_empty()
                    || !area.bytes().all(|b| b.is_ascii_digit())
                    || area.bytes().all(|b| b == b'0')
                    || issuance.as_ref().is_some_and(|d| *d != date)
                    || !keys.insert(area.clone())
                {
                    return PageVerdict::Invalid("life row");
                }
                issuance = Some(date);
                row_keys.push(area);
            }
            let Some(p) = issuance
                .filter(|d| d.len() == 10)
                .and_then(|d| Publication::parse_compact(&format!("{d}00")))
            else {
                return PageVerdict::Invalid("issuance");
            };
            if p > request.publication() {
                return PageVerdict::Invalid("future issuance");
            }
            p
        }
    };
    PageVerdict::Valid(PageReport {
        total: total as u32,
        rows: rows as u32,
        publication,
        row_keys,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebVerdict {
    Valid(Publication),
    /// The page carries no publication yet (legacy `Retry`).
    NotPublished,
    /// Older than the requested/minimum publication (legacy `Skip`).
    Stale(Publication),
    Invalid(&'static str),
}

/// Strict EUC-KR (KS X 1001) byte structure, as decoded by legacy `iconv('euc-kr')`.
pub fn euc_kr_well_formed(bytes: &[u8]) -> bool {
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b < 0x80 {
            i += 1;
            continue;
        }
        match bytes.get(i + 1) {
            Some(t) if (0xA1..=0xFE).contains(&b) && (0xA1..=0xFE).contains(t) => i += 2,
            _ => return false,
        }
    }
    true
}
fn declares_utf8(content_type: &str, body: &[u8]) -> bool {
    let head: String = body[..body.len().min(2048)]
        .iter()
        .map(|b| (*b as char).to_ascii_lowercase())
        .collect();
    let ct = content_type.to_ascii_lowercase();
    let declared = |s: &str, marker: &str| {
        s.match_indices(marker).any(|(at, _)| {
            let rest = s[at + marker.len()..].trim_start_matches([' ', '"', '\'']);
            rest.starts_with("utf-8") || rest.starts_with("utf8")
        })
    };
    declared(&ct, "charset=") || declared(&head, "charset=") || declared(&head, "encoding=")
}
/// Structure-only text view: UTF-8 as is; EUC-KR pairs become U+FFFD so ASCII markup is exact.
fn text_view(body: &[u8], utf8: bool) -> Option<String> {
    if utf8 {
        return std::str::from_utf8(body).ok().map(str::to_owned);
    }
    if !euc_kr_well_formed(body) {
        return None;
    }
    let mut out = String::with_capacity(body.len());
    let mut i = 0;
    while i < body.len() {
        if body[i] < 0x80 {
            out.push(body[i] as char);
            i += 1;
        } else {
            out.push('\u{FFFD}');
            i += 2;
        }
    }
    Some(out)
}

pub fn inspect_web(request: &WebRequest, content_type: &str, body: &[u8]) -> WebVerdict {
    match request.family() {
        WebFamily::TownRss => inspect_rss(request, body),
        family => {
            let utf8 = declares_utf8(content_type, body);
            // Legacy city decoding falls back to UTF-8 when EUC-KR decoding fails.
            let view = text_view(body, utf8).or_else(|| {
                (family == WebFamily::CityObservation && !utf8)
                    .then(|| text_view(body, true))
                    .flatten()
            });
            let Some(view) = view else {
                return WebVerdict::Invalid("charset");
            };
            // Markup inside comments is not page structure (an unterminated comment is invalid).
            let Some(view) = strip_comments(&view) else {
                return WebVerdict::Invalid("html comment");
            };
            // A truncated page (no closing `</html>`) is never a complete observation page.
            let complete = view.trim_end().to_ascii_lowercase().ends_with("</html>");
            let (publication, table) = if family == WebFamily::CityObservation {
                // Keep only the timestamp characters: the label (기상실황표) is non-ASCII and
                // appears as U+FFFD in an EUC-KR view, so it cannot be removed by text match.
                let topinfo = element_text(&view, |tag| {
                    class_has(tag, "cmp-table-topinfo") || class_has(tag, "table_topinfo")
                })
                .and_then(|t| {
                    let stamp: String = t
                        .chars()
                        .filter(|c| c.is_ascii_digit() || matches!(c, '.' | ':'))
                        .collect();
                    Publication::parse_dotted(&stamp)
                });
                let stamp = topinfo.or_else(|| {
                    tags(&view)
                        .find(|t| t.name == "input" && t.attr("name") == Some("tm"))
                        .and_then(|t| {
                            let value = t.attr("value")?.split_whitespace().collect::<String>();
                            Publication::parse_dotted(&value)
                        })
                });
                // The observation table must be closed and hold at least one data cell.
                let table = table_section(&view, false, |t| {
                    t.attr("id") == Some("weather_table") || class_has(t, "table_develop3")
                })
                .is_some_and(|section| section.to_ascii_lowercase().contains("<td"));
                (stamp, table)
            } else {
                let stamp = element_text(&view, |tag| class_has(tag, "ehead"))
                    .and_then(|t| t.split_whitespace().last().map(str::to_owned));
                // Innermost (data) table: closed, with a header row and at least one data row.
                let table = table_section(&view, true, |_| true).is_some_and(|section| {
                    let lower = section.to_ascii_lowercase();
                    lower
                        .split("<tr")
                        .skip(1)
                        .filter(|row| row.contains("<td"))
                        .count()
                        >= 2
                }) && tags(&view).filter(|t| t.name == "table").count() >= 2;
                (stamp.and_then(|s| Publication::parse_dotted(&s)), table)
            };
            let table = table && complete;
            let Some(publication) = publication else {
                return WebVerdict::NotPublished;
            };
            if request
                .publication()
                .is_some_and(|wanted| publication < wanted)
            {
                return WebVerdict::Stale(publication);
            }
            if !table {
                return WebVerdict::Invalid("observation table");
            }
            WebVerdict::Valid(publication)
        }
    }
}

fn inspect_rss(request: &WebRequest, body: &[u8]) -> WebVerdict {
    use xmlparser::{ElementEnd, Token, Tokenizer};
    let Ok(text) = std::str::from_utf8(body) else {
        return WebVerdict::Invalid("charset");
    };
    let mut stack: Vec<&str> = Vec::new();
    let (mut tm, mut x, mut y) = (None::<String>, None::<String>, None::<String>);
    let mut data = 0usize;
    let mut root = false;
    // Fields legacy `parseShortRss` reads as `item.<field>[0]` (wdEn is optional there).
    const ROW: [&str; 18] = [
        "hour", "day", "temp", "tmx", "tmn", "sky", "pty", "wfKor", "wfEn", "pop", "r12", "s12",
        "ws", "wd", "wdKor", "reh", "r06", "s06",
    ];
    let mut fields: BTreeSet<&str> = BTreeSet::new();
    let mut slots = (None::<String>, None::<String>);
    let row_complete = |fields: &BTreeSet<&str>, slots: &(Option<String>, Option<String>)| {
        let digits = |v: &Option<String>| {
            v.as_ref().is_some_and(|v| {
                let v = v.trim();
                !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit())
            })
        };
        ROW.iter().all(|f| fields.contains(f)) && digits(&slots.0) && digits(&slots.1)
    };
    for token in Tokenizer::from(text) {
        let Ok(token) = token else {
            return WebVerdict::Invalid("xml");
        };
        match token {
            Token::ElementStart { local, .. } => {
                if stack.is_empty() {
                    if root || local.as_str() != "wid" {
                        return WebVerdict::Invalid("rss root");
                    }
                    root = true;
                }
                if stack.len() >= 16 {
                    return WebVerdict::Invalid("xml depth");
                }
                stack.push(local.as_str());
                match stack.as_slice() {
                    ["wid", "body", "data"] => {
                        data += 1;
                        fields.clear();
                        slots = (None, None);
                    }
                    ["wid", "body", "data", field] if !fields.insert(field) => {
                        return WebVerdict::Invalid("duplicate rss field");
                    }
                    _ => {}
                }
            }
            Token::ElementEnd { end, .. } => {
                let closes_row = stack.as_slice() == ["wid", "body", "data"];
                match end {
                    ElementEnd::Open => continue,
                    ElementEnd::Empty => {
                        stack.pop();
                    }
                    ElementEnd::Close(_, local) => {
                        if stack.pop() != Some(local.as_str()) {
                            return WebVerdict::Invalid("xml nesting");
                        }
                    }
                }
                if closes_row && !row_complete(&fields, &slots) {
                    return WebVerdict::Invalid("rss row");
                }
            }
            Token::Text { text } => {
                let value = text.as_str().trim();
                if stack.is_empty() && !value.is_empty() {
                    return WebVerdict::Invalid("xml text");
                }
                // Text split by comments is one value: concatenate every fragment.
                match stack.as_slice() {
                    ["wid", "body", "data", "hour"] => slots
                        .0
                        .get_or_insert_with(String::new)
                        .push_str(text.as_str()),
                    ["wid", "body", "data", "day"] => slots
                        .1
                        .get_or_insert_with(String::new)
                        .push_str(text.as_str()),
                    _ => {}
                }
                let slot = match stack.as_slice() {
                    ["wid", "header", "tm"] => &mut tm,
                    ["wid", "header", "x"] => &mut x,
                    ["wid", "header", "y"] => &mut y,
                    _ => continue,
                };
                if slot.is_some() {
                    return WebVerdict::Invalid("duplicate header");
                }
                *slot = Some(value.to_owned());
            }
            Token::DtdStart { .. }
            | Token::EmptyDtd { .. }
            | Token::EntityDeclaration { .. }
            | Token::DtdEnd { .. } => return WebVerdict::Invalid("dtd"),
            // CDATA would hide part of a header or hour/day value from the text checks.
            Token::Cdata { .. }
                if matches!(
                    stack.as_slice(),
                    ["wid", "header", ..] | ["wid", "body", "data", "hour" | "day"]
                ) =>
            {
                return WebVerdict::Invalid("rss cdata");
            }
            _ => {}
        }
    }
    if !root || !stack.is_empty() || data == 0 {
        return WebVerdict::Invalid("rss structure");
    }
    let Some(publication) = tm.as_deref().and_then(Publication::parse_compact) else {
        return WebVerdict::Invalid("rss publication");
    };
    let grid = request.grid().map(|(a, b)| (a.to_string(), b.to_string()));
    if grid.as_ref().map(|(a, b)| (Some(a), Some(b))) != Some((x.as_ref(), y.as_ref())) {
        return WebVerdict::Invalid("rss grid");
    }
    if request
        .publication()
        .is_some_and(|minimum| publication < minimum)
    {
        return WebVerdict::Stale(publication);
    }
    WebVerdict::Valid(publication)
}

/// Minimal start-tag scan over a text view. Not an HTML parser; used for marker checks only.
struct Tag<'a> {
    name: String,
    attrs: Vec<(String, &'a str)>,
    end: usize,
}
impl Tag<'_> {
    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == name).map(|(_, v)| *v)
    }
}
fn class_has(tag: &Tag<'_>, class: &str) -> bool {
    tag.attr("class")
        .is_some_and(|c| c.split_ascii_whitespace().any(|x| x == class))
}
fn tags(view: &str) -> impl Iterator<Item = Tag<'_>> {
    let mut at = 0;
    std::iter::from_fn(move || {
        loop {
            let open = at + view.get(at..)?.find('<')?;
            let close = open + view[open..].find('>')?;
            at = close + 1;
            let inner = &view[open + 1..close];
            let Some(first) = inner.chars().next() else {
                continue;
            };
            if !first.is_ascii_alphabetic() {
                continue;
            }
            let name_end = inner
                .find(|c: char| c.is_ascii_whitespace() || c == '/')
                .unwrap_or(inner.len());
            let name = inner[..name_end].to_ascii_lowercase();
            return Some(Tag {
                name,
                attrs: attributes(&inner[name_end..]),
                end: close + 1,
            });
        }
    })
}
fn attributes(s: &str) -> Vec<(String, &str)> {
    let mut out = Vec::new();
    let mut rest = s;
    loop {
        rest = rest.trim_start_matches(|c: char| c.is_ascii_whitespace() || c == '/');
        if rest.is_empty() {
            return out;
        }
        let key_end = rest
            .find(|c: char| c.is_ascii_whitespace() || c == '=' || c == '/')
            .unwrap_or(rest.len());
        let key = rest[..key_end].to_ascii_lowercase();
        rest = rest[key_end..].trim_start();
        if let Some(after) = rest.strip_prefix('=') {
            let after = after.trim_start();
            let (value, next) = match after.chars().next() {
                Some(q @ ('"' | '\'')) => match after[1..].find(q) {
                    Some(end) => (&after[1..1 + end], &after[end + 2..]),
                    None => (&after[1..], ""),
                },
                _ => {
                    let end = after
                        .find(|c: char| c.is_ascii_whitespace())
                        .unwrap_or(after.len());
                    (&after[..end], &after[end..])
                }
            };
            out.push((key, value));
            rest = next;
        } else {
            out.push((key, ""));
        }
    }
}
/// Remove `<!-- ... -->` comments; `None` when a comment is never closed.
fn strip_comments(view: &str) -> Option<String> {
    let mut out = String::with_capacity(view.len());
    let mut rest = view;
    while let Some(start) = rest.find("<!--") {
        out.push_str(&rest[..start]);
        let end = rest[start + 4..].find("-->")?;
        rest = &rest[start + 4 + end + 3..];
    }
    out.push_str(rest);
    Some(out)
}
/// Markup between a selected `<table>` start tag (first match, or the last one when `last`)
/// and the next `</table>`. `None` when no table matches or it is never closed.
fn table_section(view: &str, last: bool, select: impl Fn(&Tag<'_>) -> bool) -> Option<&str> {
    let mut matches = tags(view).filter(|t| t.name == "table" && select(t));
    let tag = if last { matches.last() } else { matches.next() }?;
    let rest = &view[tag.end..];
    Some(&rest[..rest.to_ascii_lowercase().find("</table")?])
}
/// Text content of the first element matching `select`, up to its first closing tag of the
/// same name, with nested tags removed.
fn element_text(view: &str, select: impl Fn(&Tag<'_>) -> bool) -> Option<String> {
    let tag = tags(view).find(|t| select(t))?;
    let close = format!("</{}", tag.name);
    let rest = &view[tag.end..];
    let lower = rest.to_ascii_lowercase();
    let inner = &rest[..lower.find(&close)?];
    let mut out = String::new();
    let mut in_tag = false;
    for c in inner.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    Some(out)
}
