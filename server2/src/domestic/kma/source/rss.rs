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
    decode_into(raw, String::new())
}
fn decode_into(raw: &str, mut out: String) -> String {
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
/// Source-local typed XML scratch policy; public compatibility parsing has no policy handle.
struct ParsePolicy {
    used: usize,
    limit: usize,
}
impl ParsePolicy {
    fn charge(&mut self, n: usize) -> Result<(), crate::storage::Error> {
        self.used = super::forecast_cache::add(self.used, n)?;
        if self.used > self.limit {
            return Err(crate::storage::Error::Capacity);
        }
        Ok(())
    }
    fn string(&mut self, s: &str) -> Result<String, crate::storage::Error> {
        self.charge(super::forecast_cache::allocation(s.len())?)?;
        super::forecast_cache::copied(s)
    }
    fn room<T>(&mut self, v: &mut Vec<T>, additional: usize) -> Result<(), crate::storage::Error> {
        use super::forecast_cache::{add, allocation, reserve};
        let required = add(v.len(), additional)?;
        if required > v.capacity() {
            let old = if v.capacity() == 0 {
                0
            } else {
                allocation(
                    v.capacity()
                        .checked_mul(std::mem::size_of::<T>())
                        .ok_or(crate::storage::Error::Capacity)?,
                )?
            };
            let next = allocation(
                required
                    .checked_mul(std::mem::size_of::<T>())
                    .ok_or(crate::storage::Error::Capacity)?,
            )?;
            self.charge(next - old)?;
            reserve(v, additional)?;
        }
        Ok(())
    }
    fn append(&mut self, out: &mut String, text: &str) -> Result<(), crate::storage::Error> {
        use super::forecast_cache::{add, allocation};
        let required = add(out.len(), text.len())?;
        if required > super::forecast_cache::PAGE_BYTES {
            return Err(crate::storage::Error::Capacity);
        }
        if required > out.capacity() {
            let old = if out.capacity() == 0 {
                0
            } else {
                allocation(out.capacity())?
            };
            self.charge(allocation(required)? - old)?;
            out.try_reserve_exact(text.len())
                .map_err(|_| crate::storage::Error::Capacity)?;
        }
        out.push_str(text);
        Ok(())
    }
    fn decode(&mut self, raw: &str) -> Result<String, crate::storage::Error> {
        // An XML entity's decoded UTF-8 length never exceeds its source spelling.
        self.charge(super::forecast_cache::allocation(raw.len())?)?;
        let mut out = String::new();
        out.try_reserve_exact(raw.len())
            .map_err(|_| crate::storage::Error::Capacity)?;
        Ok(decode_into(raw, out))
    }
}
fn parse(xml: &[u8]) -> Option<(Element, Vec<Element>)> {
    parse_with(xml, None).ok().flatten()
}
fn parse_with(
    xml: &[u8],
    mut policy: Option<&mut ParsePolicy>,
) -> Result<Option<(Element, Vec<Element>)>, crate::storage::Error> {
    use crate::storage::Error;
    use xmlparser::{ElementEnd, Token, Tokenizer};
    let bounded = policy.is_some();
    if bounded && xml.len() > super::forecast_cache::PAGE_BYTES {
        return Err(Error::Capacity);
    }
    let Ok(text) = std::str::from_utf8(xml) else {
        return Ok(None);
    };
    let mut stack: Vec<&str> = Vec::new();
    let mut header = Element::default();
    let mut rows: Vec<Element> = Vec::new();
    let mut current_text = String::new();
    let mut text_open = false;
    let mut nodes = 0usize;
    let mut row_fields = 0usize;
    for token in Tokenizer::from(text) {
        let Ok(token) = token else { return Ok(None) };
        if bounded {
            nodes += 1;
            if nodes > 32768 {
                return Err(Error::Capacity);
            }
        }
        match token {
            Token::ElementStart { local, .. } => {
                if let Some(p) = policy.as_deref_mut() {
                    if stack.len() >= 32 {
                        return Err(Error::Capacity);
                    }
                    p.room(&mut stack, 1)?;
                }
                stack.push(local.as_str());
                if stack.len() == 3 && stack[1] == "body" && stack[2] == "data" {
                    if let Some(p) = policy.as_deref_mut() {
                        if rows.len() >= 1024 {
                            return Err(Error::Capacity);
                        }
                        p.room(&mut rows, 1)?;
                    }
                    rows.push(Element::default());
                    row_fields = 0;
                } else if stack.len() == 4 && stack[1] == "body" && stack[2] == "data" && bounded {
                    row_fields += 1;
                    if row_fields > 32 {
                        return Err(Error::Capacity);
                    }
                }
                current_text.clear();
                text_open = true;
            }
            Token::Text { text } => {
                if text_open {
                    if let Some(p) = policy.as_deref_mut() {
                        let decoded = p.decode(text.as_str())?;
                        p.append(&mut current_text, &decoded)?;
                    } else {
                        current_text.push_str(&decode(text.as_str()));
                    }
                }
            }
            Token::Cdata { text, .. } => {
                if text_open {
                    if let Some(p) = policy.as_deref_mut() {
                        p.append(&mut current_text, text.as_str())?;
                    } else {
                        current_text.push_str(text.as_str());
                    }
                }
            }
            Token::ElementEnd { end, .. } => match end {
                ElementEnd::Open => {}
                ElementEnd::Empty | ElementEnd::Close(..) => {
                    let Some(name) = stack.pop() else {
                        return Ok(None);
                    };
                    let value = std::mem::take(&mut current_text);
                    let target = match stack.as_slice() {
                        ["wid", "header"] if header.get(name).is_none() => Some(&mut header),
                        ["wid", "body", "data"] => {
                            rows.last_mut().filter(|r| r.get(name).is_none())
                        }
                        _ => None,
                    };
                    if let Some(target) = target {
                        let name = if let Some(p) = policy.as_deref_mut() {
                            p.room(&mut target.0, 1)?;
                            p.string(name)?
                        } else {
                            name.to_owned()
                        };
                        target.0.push((name, value));
                    }
                    text_open = false;
                }
            },
            _ => {}
        }
    }
    Ok((stack.is_empty() && !rows.is_empty()).then_some((header, rows)))
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
    let len = crate::domestic::kma::js::units(&s).len();
    format!("{}{s}", "0".repeat(digits.saturating_sub(len)))
}
/// `calculateTime(cur, offset)` in a UTC process.
fn calculate_time(cur: &str, offset: f64) -> String {
    let u: Vec<u16> = crate::domestic::kma::js::units(cur);
    let slice =
        |a: usize, b: usize| crate::domestic::kma::js::from16(&u[a.min(u.len())..b.min(u.len())]);
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
    convert(header, data, None).ok().flatten()
}
fn convert(
    header: Element,
    data: Vec<Element>,
    mut policy: Option<&mut ParsePolicy>,
) -> Result<Option<Parsed>, crate::storage::Error> {
    macro_rules! need {
        ($value:expr) => {
            match $value {
                Some(value) => value,
                None => return Ok(None),
            }
        };
    }
    if let Some(p) = policy.as_deref_mut() {
        for name in ["x", "y", "tm"] {
            let value = need!(header.get(name));
            p.charge(
                value
                    .len()
                    .checked_mul(4)
                    .ok_or(crate::storage::Error::Capacity)?,
            )?;
        }
    }
    let mx = if policy.is_some() {
        super::doc::bounded_int(need!(header.get("x")))?
    } else {
        parse_int(&V::s(need!(header.get("x"))))
    };
    let my = if policy.is_some() {
        super::doc::bounded_int(need!(header.get("y")))?
    } else {
        parse_int(&V::s(need!(header.get("y"))))
    };
    // Provider text in the value layer's form (it is sliced by code units below).
    let ftm = crate::domestic::kma::js::canon_str(need!(header.get("tm")));
    // `save` cannot retain another publication shape. Reject before copying it into row Docs.
    if policy.is_some() && !korea_date(&ftm).is_some_and(f64::is_finite) {
        return Ok(None);
    }
    let mut rows = Vec::new();
    if let Some(p) = policy.as_deref_mut() {
        p.room(&mut rows, data.len())?;
    }
    for item in &data {
        if let Some(p) = policy.as_deref_mut() {
            for name in ["hour", "day"] {
                if let Some(value) = item.get(name) {
                    p.charge(
                        value
                            .len()
                            .checked_mul(4)
                            .ok_or(crate::storage::Error::Capacity)?,
                    )?;
                }
            }
        }
        let hours = if policy.is_some() {
            super::doc::bounded_int(need!(item.get("hour")))?
        } else {
            parse_int(&V::s(need!(item.get("hour"))))
        };
        let days = if policy.is_some() {
            super::doc::bounded_int(need!(item.get("day")))?
        } else {
            parse_int(&V::s(need!(item.get("day"))))
        };
        let u: Vec<u16> = crate::domestic::kma::js::units(&ftm);
        let date = calculate_time(
            &(crate::domestic::kma::js::from16(&u[..8.min(u.len())]) + "0000"),
            hours + days * 24.,
        );
        let f = |k: &str| -> Option<f64> { Some(parse_float(item.get(k)?)) };
        let mut ws = need!(f("ws"));
        if crate::gateway::response::js_number(ws).len() >= 5 {
            ws = string_to_number(&to_fixed(ws, 1));
        }
        let values = [
            ("ftm", Val::str(&ftm)),
            ("date", Val::str(date)),
            ("temp", Val::Num(need!(f("temp")))),
            ("tmx", Val::Num(need!(f("tmx")))),
            ("tmn", Val::Num(need!(f("tmn")))),
            ("sky", Val::Num(need!(f("sky")))),
            ("pty", Val::Num(need!(f("pty")))),
            ("wfKor", Val::Num(weather(Some(need!(item.get("wfKor")))))),
            ("wfEn", Val::Num(weather(Some(need!(item.get("wfEn")))))),
            ("pop", Val::Num(need!(f("pop")))),
            ("r12", Val::Num(need!(f("r12")))),
            ("s12", Val::Num(need!(f("s12")))),
            ("ws", Val::Num(ws)),
            ("wd", Val::Num(need!(f("wd")))),
            ("wdKor", Val::Num(weather(Some(need!(item.get("wdKor")))))),
            ("wdEn", Val::Num(weather(item.get("wdEn")))),
            ("reh", Val::Num(need!(f("reh")))),
            ("r06", Val::Num(need!(f("r06")))),
            ("s06", Val::Num(need!(f("s06")))),
        ];
        if let Some(p) = policy.as_deref_mut() {
            let mut projected = super::forecast_cache::allocation(
                values.len() * std::mem::size_of::<(String, Val)>(),
            )?;
            for (key, value) in &values {
                projected = super::forecast_cache::add(
                    projected,
                    super::forecast_cache::allocation(key.len())?,
                )?;
                if let Val::Str(s) = value {
                    projected = super::forecast_cache::add(
                        projected,
                        super::forecast_cache::allocation(s.capacity())?,
                    )?;
                }
            }
            p.charge(projected)?;
        }
        let mut row = Doc::new();
        for (key, value) in values {
            if policy.is_some() {
                row.try_set(key, &value)?;
            } else {
                row.set(key, value);
            }
        }
        rows.push(row);
    }
    // `dataList.sort` by `date` (stable).
    rows.sort_by(|a, b| {
        let d = |r: &Doc| r.get("date").and_then(Val::as_str).unwrap_or("").to_owned();
        d(a).cmp(&d(b))
    });
    Ok(Some(Parsed {
        coord: Coord { mx, my },
        publication: ftm,
        rows,
    }))
}
/// Cache path shares the legacy tokenizer/converter with checked growth and early publication
/// rejection; no arbitrary XML tree or retained parser cache is introduced.
pub(super) fn parse_bounded(xml: &[u8]) -> Result<Option<Parsed>, crate::storage::Error> {
    let mut policy = ParsePolicy {
        used: 0,
        limit: super::forecast_cache::PARSE_BYTES,
    };
    let Some((header, data)) = parse_with(xml, Some(&mut policy))? else {
        return Ok(None);
    };
    convert(header, data, Some(&mut policy))
}

#[cfg(test)]
mod bounded_tests {
    use super::*;
    fn xml(publication: &str, rows: usize) -> Vec<u8> {
        let mut out =
            format!("<wid><header><x>60</x><y>127</y><tm>{publication}</tm></header><body>");
        for _ in 0..rows {
            out.push_str("<data><hour>12</hour><day>0</day><temp>20</temp><tmx>25</tmx><tmn>15</tmn><sky>1</sky><pty>0</pty><wfKor>맑음</wfKor><wfEn>Clear</wfEn><pop>0</pop><r12>0</r12><s12>0</s12><ws>1</ws><wd>1</wd><wdKor>동</wdKor><wdEn>E</wdEn><reh>60</reh><r06>0</r06><s06>0</s06></data>");
        }
        out.push_str("</body></wid>");
        out.into_bytes()
    }
    #[test]
    fn long_invalid_publication_is_rejected_before_broadcasting_it_into_rows() {
        let raw = xml(&"x".repeat(256 * 1024), 256);
        assert!(raw.len() < super::super::forecast_cache::PAGE_BYTES);
        let mut policy = ParsePolicy {
            used: 0,
            limit: super::super::forecast_cache::PARSE_BYTES,
        };
        let (header, data) = parse_with(&raw, Some(&mut policy)).unwrap().unwrap();
        assert_eq!(data.len(), 256);
        assert!(convert(header, data, Some(&mut policy)).unwrap().is_none());
        assert!(
            policy.used < 8 * 1024 * 1024,
            "actual checked XML/typed plan must remain below8MiB, rather than cloning a256KiB ftm256times"
        );
    }
    #[test]
    fn valid_typed_xml_matches_compatibility_and_checks_exact_scratch_boundaries() {
        let raw = xml("202609240800", 1);
        let expected = parse_rss(&raw).unwrap();
        let actual = parse_bounded(&raw).unwrap().unwrap();
        assert_eq!(actual.publication, expected.publication);
        assert_eq!(actual.coord, expected.coord);
        assert_eq!(actual.rows, expected.rows);
        let run = |limit| -> Result<usize, crate::storage::Error> {
            let mut p = ParsePolicy { used: 0, limit };
            let (h, d) = parse_with(&raw, Some(&mut p))?.unwrap();
            assert!(convert(h, d, Some(&mut p))?.is_some());
            Ok(p.used)
        };
        let used = run(super::super::forecast_cache::PARSE_BYTES).unwrap();
        assert_eq!(run(used).unwrap(), used);
        assert_eq!(run(used + 1).unwrap(), used);
        assert!(matches!(
            run(used - 1),
            Err(crate::storage::Error::Capacity)
        ));
    }
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
    pub(super) fn save_bounded(&mut self, parsed: Parsed) -> Result<(), crate::storage::Error> {
        use super::doc::checked_store;
        let Some(publication) = korea_date(&parsed.publication) else {
            return Ok(());
        };
        let coord = Doc::new()
            .with("mx", Val::num(parsed.coord.mx))
            .with("my", Val::num(parsed.coord.my));
        for row in parsed.rows {
            let Some(date) = row.get("date").and_then(Val::as_str) else {
                continue;
            };
            let Some(fcs_ms) = korea_date(date).filter(|ms| ms.is_finite()) else {
                continue;
            };
            if NUMBER_FIELDS
                .iter()
                .any(|k| matches!(row.get(k),Some(Val::Num(n)) if n.is_nan()))
            {
                continue;
            }
            let mut data = Doc::new();
            for (k, v) in row.entries() {
                match v {
                    Val::Num(n) => data.try_set(k, &Val::num(*n))?,
                    other => data.try_set(k, other)?,
                }
            }
            let at = self.docs.iter().position(|d| {
                fcs(d) == fcs_ms && d.get("mCoord") == Some(&Val::Doc(coord.clone()))
            });
            let mut d = match at {
                Some(i) => self.docs[i].checked_clone()?,
                None => Doc::new(),
            };
            if at.is_some() {
                d.try_set("shortData", &data.into())?;
                d.try_set("fcsDate", &Val::Date(fcs_ms))?;
                d.try_set("pubDate", &Val::Date(publication))?;
                d.try_set("mCoord", &Val::Doc(coord.checked_clone()?))?;
            } else {
                d.try_set("mCoord", &Val::Doc(coord.checked_clone()?))?;
                d.try_set("fcsDate", &Val::Date(fcs_ms))?;
                d.try_set("__v", &Val::Num(0.))?;
                d.try_set("shortData", &data.into())?;
                d.try_set("pubDate", &Val::Date(publication))?;
            }
            checked_store(&mut self.docs, at, d)?;
        }
        Ok(())
    }
    pub(super) fn into_answer(mut self) -> Vec<Doc> {
        self.docs.sort_by(|a, b| {
            fcs(a)
                .partial_cmp(&fcs(b))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        self.docs
    }
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
