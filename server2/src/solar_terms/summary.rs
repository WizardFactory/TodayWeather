//! Korean editorial policy, six-band priority ranking, and KST-midnight cache freshness.

use super::calendar::{DAY_MS, TermEntry, kst_midnight_ms};
use serde::Deserialize;
use std::collections::HashMap;

pub const BUNDLED_KR_POLICY_JSON: &str = include_str!("data/kr.json");

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Group {
    Featured,
    Spare,
    Calendar,
}

#[derive(Clone, Debug)]
pub struct Policy {
    groups: HashMap<String, Group>,
}

#[derive(Deserialize)]
struct RawPolicy {
    version: i64,
    terms: Vec<RawPolicyTerm>,
}

#[derive(Deserialize)]
struct RawPolicyTerm {
    id: String,
    group: Group,
}

impl Policy {
    pub fn bundled() -> Result<Self, String> {
        Self::parse_json(BUNDLED_KR_POLICY_JSON)
    }

    pub fn parse_json(json: &str) -> Result<Self, String> {
        let raw: RawPolicy =
            serde_json::from_str(json).map_err(|e| format!("invalid solar-term policy: {e}"))?;
        if raw.version < 1 || raw.terms.len() != 24 {
            return Err("solar-term policy must declare version >= 1 and 24 terms".into());
        }
        let mut groups = HashMap::with_capacity(24);
        for row in raw.terms {
            if !is_valid_term_id(&row.id) || groups.contains_key(&row.id) {
                return Err(format!("duplicate or unknown solar-term id: {}", row.id));
            }
            groups.insert(row.id, row.group);
        }
        if groups.len() != 24 {
            return Err("incomplete solar-term policy".into());
        }
        Ok(Self { groups })
    }

    pub fn group_for(&self, id: &str) -> Option<Group> {
        self.groups.get(id).copied()
    }
}

fn is_valid_term_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("solar-") else {
        return false;
    };
    let Ok(deg) = rest.parse::<u16>() else {
        return false;
    };
    deg < 360 && deg % 15 == 0 && format!("solar-{deg}") == id
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ItemKind {
    Change,
    Weather,
    Warning,
    Air,
    Precipitation,
    Discomfort,
    Feels,
    Uv,
    Wind,
}

#[derive(Clone, Debug)]
pub struct SummaryItem {
    pub kind: ItemKind,
    pub text: String,
    pub grade: f64,
}

#[derive(Clone, Debug)]
pub struct WarningItem {
    pub weather: i32,
    pub level: i32,
    pub text: String,
}

#[derive(Clone, Debug)]
pub struct GasItem {
    pub grade: i32,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DailyRange {
    pub date: String,
    pub min: String,
    pub max: String,
    pub extreme: bool,
}

#[derive(Clone, Debug)]
pub struct CurrentSnapshot {
    pub weather_type: Option<i32>,
    pub pty: Option<i32>,
    pub rn1: Option<f64>,
    pub ultrv_grade: Option<i32>,
    pub wsd_grade: Option<i32>,
    pub dspls_grade: Option<i32>,
    pub sensorytem: Option<f64>,
    pub heat_index_grade: Option<i32>,
    pub t1h: Option<f64>,
    pub t1h_text: Option<String>,
    pub temp_unit_f: bool,
    pub warnings: Vec<WarningItem>,
    pub gases: Vec<GasItem>,
}

#[derive(Clone, Debug)]
pub struct Labels {
    pub temp: String,
    pub today: String,
    pub lowest: String,
    pub highest: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Band {
    Spare = 0,
    Routine = 1,
    Featured = 2,
    Meaningful = 3,
    Risk = 4,
    Warning = 5,
}

#[derive(Clone, Debug)]
struct Candidate {
    band: Band,
    topic: String,
    grade: f64,
    text: String,
}

fn weather_risk_topic(code: i32) -> Option<&'static str> {
    match code {
        8 => Some("visibility"),
        12 => Some("air"),
        16 | 22 | 23 | 26 => Some("rain"),
        30 => Some("sleet"),
        36 | 37 | 39 | 43 | 44 | 45 | 46 => Some("snow"),
        48 => Some("waterspout"),
        49 => Some("hail"),
        50 | 51 | 52 | 55 | 56 => Some("thunderstorm"),
        58 => Some("ice"),
        63 => Some("wind"),
        _ => None,
    }
}

fn precipitation_topic(pty: i32) -> &'static str {
    match pty {
        1 | 4 | 5 => "rain",
        2 | 6 => "sleet",
        3 | 7 => "snow",
        _ => "precipitation",
    }
}

fn warning_topic(weather: i32) -> String {
    match weather {
        1 => "wind".to_owned(),
        3 => "rain".to_owned(),
        4 => "snow".to_owned(),
        9 | 12 | 13 => "temperature-risk".to_owned(),
        11 => "air".to_owned(),
        other => format!("warning-{other}"),
    }
}

fn classify(item: &SummaryItem, current: &CurrentSnapshot) -> Option<(Band, &'static str)> {
    match item.kind {
        ItemKind::Weather => {
            if let Some(code) = current.weather_type
                && let Some(topic) = weather_risk_topic(code)
            {
                return Some((Band::Risk, topic));
            }
            if let Some(pty) = current.pty
                && pty > 0
            {
                return Some((Band::Meaningful, precipitation_topic(pty)));
            }
            let band = if current.weather_type.unwrap_or(0) > 3 {
                Band::Meaningful
            } else {
                Band::Routine
            };
            Some((band, "weather"))
        }
        ItemKind::Precipitation => {
            let rn1 = current.rn1.unwrap_or(0.0);
            let pty = current.pty.unwrap_or(0);
            if !(rn1 > 0.0 && pty > 0) {
                return None;
            }
            Some((Band::Meaningful, precipitation_topic(pty)))
        }
        ItemKind::Air => Some((
            if item.grade >= 3.0 {
                Band::Risk
            } else {
                Band::Routine
            },
            "air",
        )),
        ItemKind::Uv => Some((
            if current.ultrv_grade.unwrap_or(0) >= 2 {
                Band::Risk
            } else {
                Band::Routine
            },
            "uv",
        )),
        ItemKind::Wind => Some((
            if current.wsd_grade.unwrap_or(0) >= 3 {
                Band::Risk
            } else {
                Band::Routine
            },
            "wind",
        )),
        ItemKind::Discomfort => Some((
            if current.dspls_grade.unwrap_or(0) >= 3 {
                Band::Risk
            } else {
                Band::Routine
            },
            "temperature-risk",
        )),
        ItemKind::Feels => {
            let sensory = current.sensorytem?;
            if !sensory.is_finite() || sensory == -50.0 {
                return None;
            }
            let cold_limit = if current.temp_unit_f { 14.0 } else { -10.0 };
            let risk = current.heat_index_grade.unwrap_or(0) >= 2 || sensory <= cold_limit;
            Some((
                if risk { Band::Risk } else { Band::Routine },
                "temperature-risk",
            ))
        }
        ItemKind::Change => {
            let threshold = if current.temp_unit_f { 6.0 } else { 3.0 };
            Some((
                if item.grade >= threshold {
                    Band::Meaningful
                } else {
                    Band::Routine
                },
                "change",
            ))
        }
        ItemKind::Warning => None,
    }
}

fn is_printable(text: &str) -> bool {
    if text.trim().is_empty() {
        return false;
    }
    !contains_word(text, "undefined") && !contains_word(text, "NaN")
}

fn contains_word(haystack: &str, word: &str) -> bool {
    let bytes = haystack.as_bytes();
    let wlen = word.len();
    let mut start = 0;
    while let Some(rel) = haystack[start..].find(word) {
        let pos = start + rel;
        let before = pos == 0 || !is_word_byte(bytes[pos - 1]);
        let after = pos + wlen >= bytes.len() || !is_word_byte(bytes[pos + wlen]);
        if before && after {
            return true;
        }
        start = pos + 1;
    }
    false
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// Rank weather, air, temperature, warning, and optional Korean solar-term candidates,
/// selecting up to two distinct topics joined with `", "`.
pub fn select(
    policy: &Policy,
    items: &[SummaryItem],
    current: &CurrentSnapshot,
    term: Option<&TermEntry>,
    range: Option<&DailyRange>,
    labels: &Labels,
) -> String {
    let mut candidates = Vec::new();
    let mut add = |band: Band, topic: String, grade: f64, text: String| {
        if is_printable(&text) {
            candidates.push(Candidate {
                band,
                topic,
                grade,
                text,
            });
        }
    };

    for w in &current.warnings {
        if w.weather > 0 && w.level > 0 && !w.text.is_empty() {
            add(
                Band::Warning,
                warning_topic(w.weather),
                f64::from(w.level),
                w.text.clone(),
            );
        }
    }

    for item in items {
        if let Some((band, topic)) = classify(item, current) {
            add(band, topic.to_owned(), item.grade, item.text.clone());
        }
    }

    for gas in &current.gases {
        if gas.grade >= 3 && !gas.text.is_empty() {
            add(
                Band::Risk,
                "air".to_owned(),
                f64::from(gas.grade),
                gas.text.clone(),
            );
        }
    }

    let unit_sym = if current.temp_unit_f { "℉" } else { "℃" };
    if let (Some(t1h), Some(t1h_text)) = (current.t1h, &current.t1h_text)
        && t1h.is_finite()
        && t1h != -50.0
    {
        let temp_c = if current.temp_unit_f {
            (t1h - 32.0) * 5.0 / 9.0
        } else {
            t1h
        };
        if temp_c > -50.0 && temp_c < 60.0 && (temp_c <= -12.0 || temp_c >= 33.0) {
            add(
                Band::Risk,
                "temperature-risk".to_owned(),
                3.0,
                format!("{} {}{}", labels.temp, t1h_text, unit_sym),
            );
        }
    }

    if let Some(r) = range {
        let (band, topic) = if r.extreme {
            (Band::Risk, "temperature-risk")
        } else {
            (Band::Meaningful, "range")
        };
        add(
            band,
            topic.to_owned(),
            2.5,
            format!(
                "{} {} {}{}, {} {}{}",
                labels.today, labels.lowest, r.min, unit_sym, labels.highest, r.max, unit_sym
            ),
        );
    }

    if let Some(term) = term
        && let Some(group) = policy.group_for(&term.id)
    {
        match group {
            Group::Featured => add(
                Band::Featured,
                "calendar".to_owned(),
                0.0,
                term.name_ko.clone(),
            ),
            Group::Spare => add(
                Band::Spare,
                "calendar".to_owned(),
                0.0,
                term.name_ko.clone(),
            ),
            Group::Calendar => {}
        }
    }

    // Stable sort preserves insertion order on ties.
    candidates.sort_by(|a, b| {
        b.band
            .cmp(&a.band)
            .then_with(|| b.grade.total_cmp(&a.grade))
    });

    let mut chosen: Vec<&Candidate> = Vec::with_capacity(2);
    for item in &candidates {
        if !chosen
            .iter()
            .any(|x| x.topic == item.topic || x.text == item.text)
        {
            chosen.push(item);
        }
        if chosen.len() == 2 {
            break;
        }
    }
    chosen
        .into_iter()
        .map(|c| c.text.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

/// Seconds remaining until the end of the given Korean civil date (`YYYY-MM-DD`).
pub fn remaining_seconds(iso_date: &str, now_ms: i64) -> u32 {
    let Some(midnight) = kst_midnight_ms(iso_date) else {
        return 0;
    };
    if now_ms < midnight {
        return 0;
    }
    let left_ms = (midnight + DAY_MS) - now_ms;
    if left_ms <= 0 {
        0
    } else {
        (left_ms / 1000).min(i64::from(u32::MAX)) as u32
    }
}

/// Inspect a serialized domestic response for `current.summaryForDate`.
/// Returns `Some(capped_max_age)` if `summaryForDate` is present; `None` otherwise.
pub fn summary_cache_age(body: &[u8], max_age: Option<u32>, now_ms: i64) -> Option<u32> {
    #[derive(Deserialize)]
    struct Body<'a> {
        #[serde(borrow)]
        current: Option<Current<'a>>,
    }
    #[derive(Deserialize)]
    struct Current<'a> {
        #[serde(borrow, rename = "summaryForDate")]
        summary_for_date: Option<&'a str>,
    }
    let date = serde_json::from_slice::<Body<'_>>(body)
        .ok()?
        .current?
        .summary_for_date?;
    let rem = remaining_seconds(date, now_ms);
    Some(max_age.map_or(rem, |m| m.min(rem)))
}
