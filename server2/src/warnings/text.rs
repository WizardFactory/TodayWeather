//! Situation text parsers ported from `server/models/modelKmaSpecialWeatherSituation.js`
//! and the line-change formatter of `kma.specialweather.controller.js` (ca8735cf).
use super::js::{collapse_space, is_space, ostr, trim};
use crate::gateway::OrderedJson;

/// One `info` entry; `time_str` is absent for status bullets.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Info {
    pub time_str: Option<String>,
    pub location: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Situation {
    pub weather: i32,
    pub weather_str: String,
    pub level: i32,
    pub level_str: String,
    pub info: Vec<Info>,
}
impl Situation {
    /// Legacy object order: weather, weatherStr, level, levelStr, info[{timeStr?, location}].
    pub fn to_json(&self) -> OrderedJson {
        let info = self
            .info
            .iter()
            .map(|i| {
                let mut fields = Vec::new();
                if let Some(t) = &i.time_str {
                    fields.push((super::js::key("timeStr"), ostr(t)));
                }
                fields.push((super::js::key("location"), ostr(&i.location)));
                OrderedJson::Object(fields)
            })
            .collect();
        OrderedJson::Object(vec![
            (
                super::js::key("weather"),
                OrderedJson::Number(self.weather.into()),
            ),
            (super::js::key("weatherStr"), ostr(&self.weather_str)),
            (
                super::js::key("level"),
                OrderedJson::Number(self.level.into()),
            ),
            (super::js::key("levelStr"), ostr(&self.level_str)),
            (super::js::key("info"), OrderedJson::Array(info)),
        ])
    }
}
fn situation_type(s: &str) -> (i32, &'static str) {
    // 폭풍해일 and 지진해일 contain 해일, so they are tested first (#2609).
    for (needle, weather) in [
        ("강풍", 1),
        ("풍랑", 2),
        ("호우", 3),
        ("대설", 4),
        ("건조", 5),
        ("폭풍해일", 7),
        ("지진해일", 8),
        ("해일", 6),
        ("한파", 9),
        ("태풍", 10),
        ("황사", 11),
        ("폭염", 12),
        ("열대야", 13),
    ] {
        if s.contains(needle) {
            return (weather, needle);
        }
    }
    (0, "")
}
/// `makeSituation(tStr, info)`.
pub fn make_situation(t: &str, info: Vec<Info>) -> Situation {
    let (level, level_str, unknown) = if t.contains("주의보") {
        (1, "주의보", false)
    } else if t.contains("중대경보") {
        (4, "중대경보", false)
    } else if t.contains("경보") {
        (2, "경보", false)
    } else if t.contains("예비특보") {
        (3, "예비특보", false)
    } else if t.contains("없음") {
        return Situation {
            weather: 0,
            weather_str: "없음".into(),
            level: 0,
            level_str: String::new(),
            info,
        };
    } else {
        (-1, "", true)
    };
    if unknown {
        return Situation {
            weather: -1,
            weather_str: t.into(),
            level,
            level_str: String::new(),
            info,
        };
    }
    let (weather, weather_str) = situation_type(t);
    Situation {
        weather,
        weather_str: weather_str.into(),
        level,
        level_str: level_str.into(),
        info,
    }
}
/// Split positions of `/(?:^|\s+)o\s+/` over `chars`.
fn split_o(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut parts = Vec::new();
    let mut last = 0;
    let mut i = 0;
    while i < chars.len() {
        // Alternative `^`: only at the very start.
        let mut o_at = None;
        if i == 0 && chars[0] == 'o' {
            o_at = Some(0);
        } else if is_space(chars[i]) {
            let mut j = i;
            while j < chars.len() && is_space(chars[j]) {
                j += 1;
            }
            if j < chars.len() && chars[j] == 'o' {
                o_at = Some(j);
            }
        }
        if let Some(o) = o_at
            && o + 1 < chars.len()
            && is_space(chars[o + 1])
        {
            let mut end = o + 1;
            while end < chars.len() && is_space(chars[end]) {
                end += 1;
            }
            parts.push(chars[last..i].iter().collect());
            last = end;
            i = end;
            continue;
        }
        i += 1;
    }
    parts.push(chars[last..].iter().collect());
    parts
}
/// `splitBullets(text)` -> [(head, body)].
pub fn split_bullets(text: &str) -> Vec<(String, String)> {
    let text = text.replace('\r', "");
    split_o(&text)
        .into_iter()
        .filter(|p| !trim(p).is_empty())
        .map(|part| match part.find(':') {
            None => (trim(&part).to_owned(), String::new()),
            Some(i) => (
                trim(&part[..i]).to_owned(),
                trim(&collapse_space(&part[i + 1..], " ")).to_owned(),
            ),
        })
        .collect()
}
/// `parseSpecialText(t6)`.
pub fn parse_special_text(text: &str) -> Vec<Situation> {
    split_bullets(text)
        .into_iter()
        .map(|(head, body)| {
            let name = collapse_space(&head, "");
            let info = if body.is_empty() {
                vec![]
            } else {
                vec![Info {
                    time_str: None,
                    location: body,
                }]
            };
            make_situation(&name, info)
        })
        .collect()
}
/// Split by `/\(\d+\)/` (ASCII digits).
fn split_numbered(text: &str) -> Vec<String> {
    let b = text.as_bytes();
    let mut parts = Vec::new();
    let (mut last, mut i) = (0, 0);
    while i < b.len() {
        if b[i] == b'(' {
            let mut j = i + 1;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            if j > i + 1 && j < b.len() && b[j] == b')' {
                parts.push(text[last..i].to_owned());
                last = j + 1;
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    parts.push(text[last..].to_owned());
    parts
}
/// `parsePreliminaryText(pwn)`.
pub fn parse_preliminary_text(text: &str) -> Vec<Situation> {
    let text = text.replace('\r', "");
    let mut list = Vec::new();
    for block in split_numbered(&text)
        .into_iter()
        .filter(|b| !trim(b).is_empty())
    {
        let bullets = split_bullets(&block);
        let t = trim(&block);
        if t.starts_with('o') && t[1..].starts_with(is_space) {
            for (head, _) in bullets {
                list.push(make_situation(&collapse_space(&head, ""), vec![]));
            }
            continue;
        }
        let Some((first, _)) = bullets.first() else {
            continue;
        };
        let info = bullets[1..]
            .iter()
            .map(|(head, body)| Info {
                time_str: Some(collapse_space(head, " ")),
                location: body.clone(),
            })
            .collect();
        list.push(make_situation(&collapse_space(first, ""), info));
    }
    list
}
/// `cleanText(value)` of the collector.
pub fn clean_text(value: Option<&serde_json::Value>) -> String {
    trim(&super::js::text(value).replace('\r', "")).to_owned()
}
/// `_insertLineChange(strSituationList, string)` over UTF-16 code units.
pub fn insert_line_change(situations: &[Vec<u16>], string: &[u16]) -> Vec<u16> {
    const BREAK2: [u16; 5] = [b'<' as u16, b'*' as u16, b'o' as u16, b'-' as u16, 0x203b];
    let mut out = Vec::with_capacity(string.len() + 16);
    for i in 0..string.len() {
        if BREAK2.contains(&string[i]) && i != 0 {
            out.extend([10, 10]);
        }
        if string[i] == b'[' as u16 {
            out.push(10);
        }
        // `find` returns the first matching string; an empty first match is falsy.
        if situations
            .iter()
            .find(|s| string[i..(i + s.len()).min(string.len())] == s[..])
            .is_some_and(|s| !s.is_empty())
        {
            out.push(10);
        }
        out.push(string[i]);
    }
    out
}
