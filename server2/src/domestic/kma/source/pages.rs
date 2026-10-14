//! KMA observation pages as the legacy scraper reads them (`server/lib/kmaScraper.js`):
//! `getAWSWeather` + `_parseStnMinInfo` for the AWS minute/hourly page (`nph-aws_txt_min`, all
//! stations nationwide in one page), `getCityWeather` + `_decodeKmaHtml` + `_parseCityWeatherHtml`
//! for the city observation page (`currentweather.jsp`, all city stations in one page) and
//! `_mergeAWSandCity`. Rows are the plain objects legacy builds (insertion-ordered fields,
//! `date` a Date in the KST wall clock as UTC fields).
use super::doc::{Doc, Val};
use super::html::{self, Document, ROOT};
use crate::domestic::kma::js::{V, parse_float, parse_int};
use crate::domestic::kma::precip::js_ws;

/// Why legacy rejects a page (the scraper callback error).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PageError {
    /// Iconv/parse failure of the whole page.
    Decode,
    /// No publication time (`err.state = 'Retry'`).
    NoPublication,
    /// Older than the requested publication (`'Skip'` / city "not updated").
    Stale,
    /// The page cannot be read as legacy reads it (not reproduced: the page is not used).
    Unsupported,
}

/// Strict EUC-KR (KS X 1001), as `new Iconv('euc-kr', 'UTF8')` converts; None where iconv
/// throws `Illegal character sequence`.
pub fn decode_euc_kr(bytes: &[u8]) -> Option<String> {
    if !crate::domestic::format::euc_kr_well_formed(bytes) {
        return None;
    }
    encoding_rs::EUC_KR
        .decode_without_bom_handling_and_without_replacement(bytes)
        .map(|s| s.into_owned())
}
/// `_decodeKmaHtml(body, response)`: UTF-8 when declared (content type or the first 2,048
/// bytes), otherwise EUC-KR, falling back to UTF-8 when iconv fails.
pub fn decode_kma_html(bytes: &[u8], content_type: &str) -> String {
    let head: String = bytes[..bytes.len().min(2048)]
        .iter()
        .map(|b| *b as char)
        .collect();
    if declares(content_type, false) || declares(&head, true) {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    decode_euc_kr(bytes).unwrap_or_else(|| String::from_utf8_lossy(bytes).into_owned())
}
/// `/charset\s*=\s*utf-?8/i` (with an optional quote when `quoted`).
fn declares(text: &str, quoted: bool) -> bool {
    let lower = text.to_lowercase();
    let mut from = 0;
    while let Some(at) = lower[from..].find("charset") {
        let rest = &lower[from + at + "charset".len()..];
        let rest = rest.trim_start_matches(js_ws);
        if let Some(rest) = rest.strip_prefix('=') {
            let mut rest = rest.trim_start_matches(js_ws);
            if quoted {
                rest = rest
                    .strip_prefix('"')
                    .or_else(|| rest.strip_prefix('\''))
                    .unwrap_or(rest);
            }
            if rest.starts_with("utf8") || rest.starts_with("utf-8") {
                return true;
            }
        }
        from += at + 1;
    }
    false
}

/// JavaScript `s.replace(/\s+/, "")`: the first whitespace run removed.
fn strip_first_ws(s: &str) -> String {
    match s.char_indices().find(|(_, c)| js_ws(*c)) {
        None => s.to_owned(),
        Some((start, _)) => {
            let end = s[start..]
                .char_indices()
                .find(|(_, c)| !js_ws(*c))
                .map_or(s.len(), |(i, _)| start + i);
            format!("{}{}", &s[..start], &s[end..])
        }
    }
}
/// `.replace(/(\r\n|\n|\r)/gm, "")`.
fn strip_newlines(s: &str) -> String {
    s.chars().filter(|c| *c != '\n' && *c != '\r').collect()
}
/// `.replace(/\s+/g, "")`.
fn strip_all_ws(s: &str) -> String {
    s.chars().filter(|c| !js_ws(*c)).collect()
}

/// `new Date('YYYY.MM.DD.HH:MM')` in the UTC legacy process, for the exact page form.
pub fn page_date(s: &str) -> f64 {
    crate::domestic::kma::time::parse_date(s.trim_matches(js_ws))
}

/// One AWS page (`{pubDate, stnList}`).
#[derive(Debug, Clone)]
pub struct AwsPage {
    pub pub_date: String,
    pub rows: Vec<Doc>,
}
const AWS_FIELDS: [&str; 20] = [
    "stnId", "stnName", "altitude", "rns", "rs15m", "rs1h", "rs3h", "rs6h", "rs12h", "rs1d", "t1h",
    "vec1", "wdd1", "wsd1", "vec", "wdd", "wsd", "reh", "hPa", "addr",
];
/// `getAWSWeather` decoding plus `_parseStnMinInfo(pubDate, $)`. `requested` is the hourly
/// `YYYY.MM.DD.HH:MM` the run asked for (None for the minute page).
pub fn parse_aws(bytes: &[u8], requested: Option<&str>) -> Result<AwsPage, PageError> {
    let text = decode_euc_kr(bytes).ok_or(PageError::Decode)?;
    let doc = html::parse(&text).map_err(|_| PageError::Unsupported)?;
    parse_aws_doc(&doc, requested)
}
fn parse_aws_doc(doc: &Document, requested: Option<&str>) -> Result<AwsPage, PageError> {
    let all = doc.descendants(ROOT);
    let ehead: String = all
        .iter()
        .filter(|n| doc.has_class(**n, "ehead"))
        .map(|n| doc.text(*n, false))
        .collect();
    let pub_date = ehead.split(' ').next_back().unwrap_or("").to_owned();
    if pub_date.is_empty() || pub_date.encode_utf16().count() < 12 {
        return Err(PageError::NoPublication);
    }
    let pub_ms = page_date(&pub_date);
    if let Some(req) = requested
        && pub_ms < page_date(req)
    {
        return Err(PageError::Stale);
    }
    // `$('table table')`: tables inside a table, document order; `.children('tr')`.
    let tables: Vec<usize> = all
        .iter()
        .copied()
        .filter(|n| {
            doc.name(*n) == "table"
                && doc.ancestors(*n).iter().any(|a| doc.name(*a) == "table")
        })
        .collect();
    let mut rows = Vec::new();
    let mut index = 0;
    for table in tables {
        for tr in doc.child_elements(table, "tr") {
            if index == 0 {
                index += 1;
                continue;
            }
            let mut row = Doc::new().with("date", Val::Date(pub_ms));
            let mut p = 0usize;
            for td in doc.child_elements(tr, "td") {
                let t = strip_first_ws(&strip_newlines(&strip_first_ws(&doc.text(td, false))));
                if t != "." && t != "-"
                    && let Some(name) = AWS_FIELDS.get(p)
                {
                    match *name {
                        "altitude" | "reh" => {
                            let v = parse_int(&V::s(&t));
                            if !v.is_nan() {
                                row.set(name, Val::Num(v));
                            }
                        }
                        "rns" => {
                            if t == "○" {
                                row.set(name, Val::Bool(false));
                            } else if t == "●" {
                                row.set(name, Val::Bool(true));
                            }
                        }
                        "rs15m" | "rs1h" | "rs6h" | "rs12h" | "rs1d" | "t1h" | "vec1" | "wsd1"
                        | "vec" | "wsd" | "hPa" => {
                            let v = parse_float(&V::s(&t));
                            if !v.is_nan() {
                                row.set(name, Val::Num(v));
                            }
                        }
                        _ => row.set(name, Val::str(t)),
                    }
                } else if t != "." && t != "-" {
                    // `stnMinInfo[undefined] = tdText`: the row is rejected below anyway.
                }
                p += 1;
            }
            let zero = |k: &str| row.get(k) == Some(&Val::Num(0.));
            if p > AWS_FIELDS.len() || (zero("t1h") && zero("vec") && zero("wsd") && zero("vec1"))
            {
                continue;
            }
            rows.push(row);
            index += 1;
        }
    }
    Ok(AwsPage { pub_date, rows })
}

/// One city page (`{pubDate, cityList}`).
#[derive(Debug, Clone)]
pub struct CityPage {
    pub pub_date: String,
    pub rows: Vec<Doc>,
}
/// `getCityWeather` decoding plus `_parseCityWeatherHtml(html, pubDate)`.
pub fn parse_city(
    bytes: &[u8],
    content_type: &str,
    requested: Option<&str>,
) -> Result<CityPage, PageError> {
    let text = decode_kma_html(bytes, content_type);
    let doc = html::parse(&text).map_err(|_| PageError::Unsupported)?;
    let all = doc.descendants(ROOT);
    let text_of = |class: &str| -> String {
        all.iter()
            .filter(|n| doc.has_class(**n, class))
            .map(|n| doc.text(*n, false))
            .collect()
    };
    let mut topinfo = text_of("cmp-table-topinfo");
    if topinfo.is_empty() {
        topinfo = text_of("table_topinfo");
    }
    let mut pub_date = strip_all_ws(&topinfo.replacen("기상실황표", "", 1));
    if pub_date.is_empty() {
        let value = all
            .iter()
            .find(|n| doc.name(**n) == "input" && doc.attr(**n, "name") == Some("tm"))
            .and_then(|n| doc.attr(*n, "value"))
            .unwrap_or("");
        pub_date = strip_all_ws(value);
    }
    if !city_pub_shape(&pub_date) {
        return Err(PageError::NoPublication);
    }
    let pub_ms = page_date(&pub_date);
    if let Some(req) = requested
        && pub_ms < page_date(req)
    {
        return Err(PageError::Stale);
    }
    let mut tables: Vec<usize> = all
        .iter()
        .copied()
        .filter(|n| doc.attr(*n, "id") == Some("weather_table"))
        .collect();
    if tables.is_empty() {
        tables = all
            .iter()
            .copied()
            .filter(|n| doc.has_class(*n, "table_develop3"))
            .collect();
    }
    let mut fields: Vec<&'static str> = vec!["stnId", "stnName"];
    let mut header_index = 0;
    for table in &tables {
        for th in descendants_matching(&doc, *table, &["thead"], Some("table_header2"), "th") {
            let name = strip_all_ws(&strip_newlines(&doc.text(th, true))).replace('\u{a0}', "");
            if header_index > 0 {
                fields.push(match name.as_str() {
                    "현재일기" => "weather",
                    "시정km" => "visibility",
                    "운량1/10" => "cloud",
                    "중하운량" => "heavyCloud",
                    "현재기온" => "t1h",
                    "이슬점온도" => "dpt",
                    "체감온도" => "sensoryTem",
                    "불쾌지수" => "dspls",
                    "일강수mm" => "r1d",
                    "적설cm" => "s1d",
                    "습도%" => "reh",
                    "풍향" => "wdd",
                    "풍속m/s" | "풍속" => "wsd",
                    "해면기압" => "hPa",
                    _ => "unknown",
                });
            }
            header_index += 1;
        }
    }
    if fields.len() <= 2 {
        return Err(PageError::NoPublication);
    }
    let mut rows = Vec::new();
    for table in &tables {
        for tr in descendants_matching(&doc, *table, &["tbody"], None, "tr") {
            let mut row = Doc::new();
            let mut i = 0usize;
            for td in doc.child_elements(tr, "td") {
                if i == 0 {
                    let a = doc.child_elements(td, "a").first().copied();
                    let href = a.and_then(|a| doc.attr(a, "href")).unwrap_or("");
                    if let Some(id) = stn_param(href) {
                        row.set("stnId", Val::str(id));
                    }
                    let mut name =
                        strip_all_ws(&strip_newlines(&a.map_or_else(|| doc.text(td, false), |a| doc.text(a, false))));
                    if name == "백령도" {
                        name = "백령".into();
                    }
                    row.set("stnName", Val::str(name));
                    i = 2;
                    continue;
                }
                let key = fields.get(i).copied();
                let mut t = strip_all_ws(&strip_newlines(&doc.text(td, true))).replace('\u{a0}', "");
                if key == Some("wsd") && t.is_empty() {
                    let script = doc
                        .descendants(td)
                        .into_iter()
                        .find(|n| doc.name(*n) == "script")
                        .map(|n| doc.inner_text_raw(n))
                        .unwrap_or_default();
                    if let Some(v) = wind_speed(&script) {
                        t = v;
                    }
                }
                match key {
                    Some(k @ ("visibility" | "cloud" | "heavyCloud" | "dspls" | "reh")) => {
                        let v = parse_int(&V::s(&t));
                        if !v.is_nan() {
                            row.set(k, Val::Num(v));
                        }
                    }
                    Some(k @ ("t1h" | "sensoryTem" | "dpt" | "r1d" | "s1d" | "wsd" | "hPa")) => {
                        let v = parse_float(&V::s(&t));
                        if !v.is_nan() {
                            row.set(k, Val::Num(v));
                        }
                    }
                    Some("wdd") => {
                        if !t.is_empty() {
                            let eng = t
                                .replace('동', "E")
                                .replace('서', "W")
                                .replace('남', "S")
                                .replace('북', "N");
                            row.set("wdd", Val::str(eng));
                        }
                    }
                    Some("unknown") | None => {}
                    Some(k) => row.set(k, Val::str(t)),
                }
                i += 1;
            }
            row.set("date", Val::Date(pub_ms));
            if row.has("stnId") {
                rows.push(row);
            }
        }
    }
    Ok(CityPage { pub_date, rows })
}
/// `/^\d{4}\.\d{1,2}\.\d{1,2}\.\d{1,2}:\d{2}$/`.
fn city_pub_shape(s: &str) -> bool {
    let Some((date, time)) = s.rsplit_once('.') else {
        return false;
    };
    let d: Vec<&str> = date.split('.').collect();
    let digits = |x: &str, lo: usize, hi: usize| {
        (lo..=hi).contains(&x.len()) && x.bytes().all(|b| b.is_ascii_digit())
    };
    let Some((h, m)) = time.split_once(':') else {
        return false;
    };
    d.len() == 3
        && digits(d[0], 4, 4)
        && digits(d[1], 1, 2)
        && digits(d[2], 1, 2)
        && digits(h, 1, 2)
        && digits(m, 2, 2)
}
/// `/[?&]stn=(\d+)/`.
fn stn_param(href: &str) -> Option<String> {
    let b = href.as_bytes();
    let mut from = 0;
    while let Some(at) = href[from..].find("stn=") {
        let pos = from + at;
        if pos > 0 && matches!(b[pos - 1], b'?' | b'&') {
            let digits: String = href[pos + 4..]
                .chars()
                .take_while(char::is_ascii_digit)
                .collect();
            if !digits.is_empty() {
                return Some(digits);
            }
        }
        from = pos + 1;
    }
    None
}
/// `/writeWindSpeed\(\s*['"]([-\d.]+)['"]/`.
fn wind_speed(script: &str) -> Option<String> {
    let at = script.find("writeWindSpeed(")?;
    let rest = script[at + "writeWindSpeed(".len()..].trim_start_matches(js_ws);
    let quote = rest.chars().next().filter(|c| *c == '\'' || *c == '"')?;
    let rest = &rest[1..];
    let value: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '-' || *c == '.')
        .collect();
    let after = &rest[value.len()..];
    (!value.is_empty() && after.starts_with(['\'', '"'])).then(|| {
        let _ = quote;
        value
    })
}
/// `table.find('<ancestor...> [#id] <tag>')`: `tag` descendants of `scope` that have every
/// `ancestors` name (and the `id`) on their ancestor chain, in document order.
fn descendants_matching(
    doc: &Document,
    scope: usize,
    ancestors: &[&str],
    id: Option<&str>,
    tag: &str,
) -> Vec<usize> {
    doc.descendants(scope)
        .into_iter()
        .filter(|n| doc.name(*n) == tag)
        .filter(|n| {
            let chain = doc.ancestors(*n);
            let mut pos = 0;
            // The id element must be an ancestor; the named ancestors must be above it.
            if let Some(id) = id {
                match chain.iter().position(|a| doc.attr(*a, "id") == Some(id)) {
                    Some(p) => pos = p + 1,
                    None => return false,
                }
            }
            ancestors
                .iter()
                .all(|name| chain[pos..].iter().any(|a| doc.name(*a) == *name))
        })
        .collect()
}

/// `_mergeAWSandCity(awsList, cityList)`.
pub fn merge_aws_city(mut aws: Vec<Doc>, city: &[Doc]) -> Vec<Doc> {
    for c in city {
        let id = c.get("stnId").cloned();
        match aws.iter_mut().find(|a| a.get("stnId") == id.as_ref()) {
            Some(a) => {
                for (k, v) in c.entries() {
                    a.set(k, v.clone());
                }
                a.set("isCityWeather", Val::Bool(true));
            }
            None => {
                let mut row = c.clone();
                row.set("isCityWeather", Val::Bool(true));
                aws.push(row);
            }
        }
    }
    aws
}
