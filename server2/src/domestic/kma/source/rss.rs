//! `kma.town.short.rss` documents rebuilt from `town-rss` acquisitions (KMA `queryDFS.jsp` XML)
//! with the legacy `TownRss` at master: `parseShortRss` (xml2js fields as `item.x[0]`),
//! `saveShortRssNewForm` (upsert per `fcsDate`, last write wins, a Mongoose cast error skips the
//! row) and `remove` (216 h before the hourly run's wall clock). A run whose publication is
//! already stored is skipped, as `checkPubDate` does.
use super::doc::{Doc, Val};
use super::grid::{Coord, RETENTION_MS, korea_date};
use crate::domestic::kma::js::{V, parse_int};
use crate::world::js::{parse_float, string_to_number, to_fixed};

/// One `data` element (or the header): first text of each child element, in document order.
#[derive(Debug, Default, Clone)]
struct Element(Vec<(String, String)>);
impl Element {
    fn get(&self, k: &str) -> Option<&str> {
        self.0.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str())
    }
}
fn decode(raw: &str) -> String {
    let mut out = String::new();
    let mut rest = raw;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let Some(end) = tail.find(';') else {
            out.push_str(tail);
            return out;
        };
        let name = &tail[1..end];
        let ch = match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            n if n.starts_with("#x") => u32::from_str_radix(&n[2..], 16)
                .ok()
                .and_then(char::from_u32),
            n if n.starts_with('#') => n[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => out.push(c),
            None => out.push_str(&tail[..=end]),
        }
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    out
}
/// Header and data rows of a `wid` document; None for unparsable XML.
fn parse(xml: &[u8]) -> Option<(Element, Vec<Element>)> {
    use xmlparser::{ElementEnd, Token, Tokenizer};
    let text = std::str::from_utf8(xml).ok()?;
    let mut stack: Vec<String> = Vec::new();
    let mut header = Element::default();
    let mut rows: Vec<Element> = Vec::new();
    let mut current_text = String::new();
    let mut text_open = false;
    for token in Tokenizer::from(text) {
        match token.ok()? {
            Token::ElementStart { local, .. } => {
                stack.push(local.as_str().to_owned());
                if stack.len() == 3 && stack[1] == "body" && stack[2] == "data" {
                    rows.push(Element::default());
                }
                current_text.clear();
                text_open = true;
            }
            Token::Text { text } => {
                if text_open {
                    current_text.push_str(&decode(text.as_str()));
                }
            }
            Token::Cdata { text, .. } => {
                if text_open {
                    current_text.push_str(text.as_str());
                }
            }
            Token::ElementEnd { end, .. } => match end {
                ElementEnd::Open => {}
                ElementEnd::Empty | ElementEnd::Close(..) => {
                    let name = stack.pop()?;
                    let path: Vec<&str> = stack.iter().map(String::as_str).collect();
                    let value = std::mem::take(&mut current_text);
                    match path.as_slice() {
                        ["wid", "header"] if header.get(&name).is_none() => {
                            header.0.push((name, value))
                        }
                        ["wid", "body", "data"] => {
                            if let Some(row) = rows.last_mut()
                                && row.get(&name).is_none()
                            {
                                row.0.push((name, value));
                            }
                        }
                        _ => {}
                    }
                    text_open = false;
                }
            },
            _ => {}
        }
    }
    (stack.is_empty() && !rows.is_empty()).then_some((header, rows))
}
/// `convertWeatherString`.
fn weather(s: Option<&str>) -> f64 {
    match s {
        Some("맑음" | "Clear" | "동" | "E") => 1.,
        Some("구름 조금" | "Partly Cloudy" | "북" | "N") => 2.,
        Some("구름 많음" | "Mostly Cloudy" | "북동" | "NE") => 3.,
        Some("흐림" | "Cloudy" | "북서" | "NW") => 4.,
        Some("비" | "Rain" | "남" | "S") => 5.,
        Some("눈/비" | "Snow/Rain" | "남동" | "SE") => 6.,
        Some("눈" | "Snow" | "남서" | "SW") => 7.,
        Some("서" | "W") => 8.,
        _ => -1.,
    }
}
/// `leadingZeros(n, digits)`.
fn lead(n: f64, digits: usize) -> String {
    let s = crate::gateway::response::js_number(n);
    let len = s.encode_utf16().count();
    format!("{}{s}", "0".repeat(digits.saturating_sub(len)))
}
/// `calculateTime(cur, offset)` in a UTC process.
fn calculate_time(cur: &str, offset: f64) -> String {
    let u: Vec<u16> = cur.encode_utf16().collect();
    let slice = |a: usize, b: usize| String::from_utf16_lossy(&u[a.min(u.len())..b.min(u.len())]);
    let iso = format!(
        "{}-{}-{}T{}:{}",
        slice(0, 4),
        slice(4, 6),
        slice(6, 8),
        slice(8, 10),
        slice(10, 12)
    );
    let base = local_iso(&iso);
    let t = base + offset * 3_600_000.;
    match crate::world::js::parts(t) {
        Some(p) if t.is_finite() => format!(
            "{}{}{}{}{}",
            lead(p.year as f64, 4),
            lead(p.month as f64, 2),
            lead(p.day as f64, 2),
            lead(p.hour as f64, 2),
            lead(p.minute as f64, 2)
        ),
        _ => "NaNNaNNaNNaNNaN".into(),
    }
}
/// `new Date('YYYY-MM-DDTHH:MM')` (no offset: local time, UTC here); NaN unless exact.
fn local_iso(s: &str) -> f64 {
    let b = s.as_bytes();
    if b.len() != 16 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' {
        return f64::NAN;
    }
    let n = |r: std::ops::Range<usize>| -> Option<f64> {
        let t = &s[r];
        t.bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| t.parse().ok())
            .flatten()
    };
    let (Some(y), Some(m), Some(d), Some(h), Some(mi)) =
        (n(0..4), n(5..7), n(8..10), n(11..13), n(14..16))
    else {
        return f64::NAN;
    };
    if !(1. ..=12.).contains(&m)
        || !(1. ..=31.).contains(&d)
        || h > 24.
        || mi > 59.
        || (h == 24. && mi > 0.)
    {
        return f64::NAN;
    }
    crate::domestic::kma::time::make_date_literal(y, m - 1., d, h, mi, 0.)
}
const NUMBER_FIELDS: [&str; 17] = [
    "temp", "tmx", "tmn", "sky", "pty", "wfKor", "wfEn", "pop", "r12", "s12", "ws", "wd", "wdKor",
    "wdEn", "reh", "r06", "s06",
];
/// One parsed acquisition: grid, publication text and rows (`parseShortRss`).
pub struct Parsed {
    pub coord: Coord,
    pub publication: String,
    rows: Vec<Doc>,
}
/// `parseShortRss`; None when legacy reports a parse error.
pub fn parse_rss(xml: &[u8]) -> Option<Parsed> {
    let (header, data) = parse(xml)?;
    let mx = parse_int(&V::s(header.get("x")?));
    let my = parse_int(&V::s(header.get("y")?));
    let ftm = header.get("tm")?.to_owned();
    let mut rows = Vec::new();
    for item in &data {
        let hours = parse_int(&V::s(item.get("hour")?));
        let days = parse_int(&V::s(item.get("day")?));
        let u: Vec<u16> = ftm.encode_utf16().collect();
        let date = calculate_time(
            &(String::from_utf16_lossy(&u[..8.min(u.len())]) + "0000"),
            hours + days * 24.,
        );
        let f = |k: &str| -> Option<f64> { Some(parse_float(item.get(k)?)) };
        let mut ws = f("ws")?;
        if crate::gateway::response::js_number(ws).len() >= 5 {
            ws = string_to_number(&to_fixed(ws, 1));
        }
        let row = Doc::new()
            .with("ftm", Val::str(&ftm))
            .with("date", Val::str(date))
            .with("temp", Val::Num(f("temp")?))
            .with("tmx", Val::Num(f("tmx")?))
            .with("tmn", Val::Num(f("tmn")?))
            .with("sky", Val::Num(f("sky")?))
            .with("pty", Val::Num(f("pty")?))
            .with("wfKor", Val::Num(weather(Some(item.get("wfKor")?))))
            .with("wfEn", Val::Num(weather(Some(item.get("wfEn")?))))
            .with("pop", Val::Num(f("pop")?))
            .with("r12", Val::Num(f("r12")?))
            .with("s12", Val::Num(f("s12")?))
            .with("ws", Val::Num(ws))
            .with("wd", Val::Num(f("wd")?))
            .with("wdKor", Val::Num(weather(Some(item.get("wdKor")?))))
            .with("wdEn", Val::Num(weather(item.get("wdEn"))))
            .with("reh", Val::Num(f("reh")?))
            .with("r06", Val::Num(f("r06")?))
            .with("s06", Val::Num(f("s06")?));
        rows.push(row);
    }
    // `dataList.sort` by `date` (stable).
    rows.sort_by(|a, b| {
        let d = |r: &Doc| r.get("date").and_then(Val::as_str).unwrap_or("").to_owned();
        d(a).cmp(&d(b))
    });
    Some(Parsed {
        coord: Coord { mx, my },
        publication: ftm,
        rows,
    })
}

/// One grid's RSS documents in natural order.
#[derive(Debug, Clone, Default)]
pub struct RssDocs {
    docs: Vec<Doc>,
}
fn fcs(d: &Doc) -> f64 {
    match d.get("fcsDate") {
        Some(Val::Date(ms)) => *ms,
        _ => f64::NAN,
    }
}
impl RssDocs {
    pub fn docs(&self) -> &[Doc] {
        &self.docs
    }
    /// `checkPubDate`: a stored document already carries this publication.
    pub fn has_publication(&self, publication_ms: f64) -> bool {
        self.docs
            .iter()
            .any(|d| d.get("pubDate") == Some(&Val::Date(publication_ms)))
    }
    /// `saveShortRssNewForm`.
    pub fn save(&mut self, parsed: Parsed) {
        let Some(publication) = korea_date(&parsed.publication) else {
            return;
        };
        let coord = Doc::new()
            .with("mx", Val::num(parsed.coord.mx))
            .with("my", Val::num(parsed.coord.my));
        for row in parsed.rows {
            let date = row
                .get("date")
                .and_then(Val::as_str)
                .unwrap_or("")
                .to_owned();
            let Some(fcs_ms) = korea_date(&date).filter(|ms| ms.is_finite()) else {
                continue;
            };
            // A NaN number is a Mongoose CastError: the row is not written.
            if NUMBER_FIELDS
                .iter()
                .any(|k| matches!(row.get(k), Some(Val::Num(n)) if n.is_nan()))
            {
                continue;
            }
            let mut data = Doc::new();
            for (k, v) in row.entries() {
                data.set(
                    k,
                    match v {
                        Val::Num(n) => Val::num(*n),
                        other => other.clone(),
                    },
                );
            }
            let at = self.docs.iter().position(|d| {
                fcs(d) == fcs_ms && d.get("mCoord") == Some(&Val::Doc(coord.clone()))
            });
            match at {
                Some(i) => {
                    let d = &mut self.docs[i];
                    d.set("shortData", data.into());
                    d.set("fcsDate", Val::Date(fcs_ms));
                    d.set("pubDate", Val::Date(publication));
                    d.set("mCoord", coord.clone().into());
                }
                None => self.docs.push(
                    Doc::new()
                        .with("mCoord", coord.clone().into())
                        .with("fcsDate", Val::Date(fcs_ms))
                        .with("__v", Val::Num(0.))
                        .with("shortData", data.into())
                        .with("pubDate", Val::Date(publication)),
                ),
            }
        }
    }
    /// `remove(now)`: `fcsDate <= now - 216 h`.
    pub fn retain(&mut self, run_ms: f64) {
        let limit = run_ms - RETENTION_MS;
        self.docs.retain(|d| fcs(d) > limit || fcs(d).is_nan());
    }
    pub fn answer(&self) -> Vec<Doc> {
        let mut out = self.docs.clone();
        out.sort_by(|a, b| {
            fcs(a)
                .partial_cmp(&fcs(b))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        out
    }
}
/// The last hourly RSS run (minute 2) at or before `t`.
pub fn last_run(t: f64) -> f64 {
    let hour = 3_600_000.;
    let candidate = (t / hour).floor() * hour + 120_000.;
    if candidate <= t {
        candidate
    } else {
        candidate - hour
    }
}
