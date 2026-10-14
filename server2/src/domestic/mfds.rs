//! S15b-3b: the keyless MFDS food-poisoning risk acquisition. Ported from
//! `lib/foodPoisoning.js` at `7ca6f002`: `ENDPOINT` (L4), `fetchRisk` (L60: one HTTPS GET with an
//! absolute 10 s deadline, at most 1 MiB, no retry), `slot`/`due` (L127/L136: 08:20, 12:20 and
//! 17:20 KST) and `parse` (L22). The provider needs no key and no S08 funding; the request uses the
//! S08 keyless transport bounds. A body `parse` rejects is not a record (legacy saves nothing).
use super::publication::Publication;
use crate::storage::{Period, ProviderKey};
use reqwest::Url;
use serde_json::Value;
use std::time::Duration;

/// Raw record source and kind.
pub const SOURCE: &str = "mfds";
pub const KIND: &str = "mfds-food-poisoning";
/// `ENDPOINT` path below the provider root (`https://poisonmap.mfds.go.kr/`).
pub const PATH: &str = "api/risk.do";
pub const DEFAULT_ROOT: &str = "https://poisonmap.mfds.go.kr/";
/// `fetchRisk` `timeoutMs` and `maxBytes`.
pub const TIMEOUT: Duration = Duration::from_secs(10);
pub const MAX_BYTES: usize = 1024 * 1024;
const DAY_MS: f64 = 86_400_000.;
const HOUR_MS: f64 = 3_600_000.;
/// Collection slots (KST minutes of the day).
const SLOTS: [u16; 3] = [820, 1220, 1720];

/// One slot's acquisition of the national risk table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MfdsRequest {
    slot: Publication,
    endpoint: Url,
}
impl MfdsRequest {
    /// `slot` must be one of the three daily KST slots.
    pub fn new(root: &Url, slot: Publication) -> Result<Self, super::DomesticError> {
        if !SLOTS.contains(&slot.time()) {
            return Err(super::DomesticError::Invalid("mfds slot"));
        }
        let endpoint = root
            .join(PATH)
            .map_err(|_| super::DomesticError::Invalid("endpoint"))?;
        Ok(Self { slot, endpoint })
    }
    pub fn slot(&self) -> Publication {
        self.slot
    }
    pub fn endpoint(&self) -> &Url {
        &self.endpoint
    }
    pub fn provider_key() -> ProviderKey {
        ProviderKey::Named {
            id: "nation".into(),
        }
    }
    /// The record period: the slot (`YYYYMMDD`, `HHMM`).
    pub fn period(&self) -> Period {
        self.slot.period()
    }
    /// Catalog partition: the slot's KST day.
    pub fn partition(&self) -> String {
        self.slot.base_date()
    }
}
/// `slot(now)`: the latest collection slot of the KST day at or before `now`, if any.
pub fn slot_at(now_ms: f64) -> Option<Publication> {
    let p = crate::world::js::parts(now_ms + 9. * HOUR_MS)?;
    let date = (p.year * 10000 + p.month * 100 + p.day) as u32;
    let time = (p.hour * 100 + p.minute) as u16;
    SLOTS
        .iter()
        .rev()
        .find(|s| **s <= time)
        .and_then(|s| Publication::new(date, *s))
}
/// The instant (ms) a KST slot starts.
pub fn slot_ms(slot: Publication) -> f64 {
    let d = slot.date();
    crate::world::js::days_from_civil(
        i64::from(d / 10000),
        i64::from(d / 100 % 100),
        i64::from(d % 100),
    ) as f64
        * DAY_MS
        + f64::from(slot.hour()) * HOUR_MS
        + f64::from(slot.minute()) * 60_000.
        - 9. * HOUR_MS
}

/// One stored row in `$set` order (`_id` first).
#[derive(Debug, Clone, PartialEq)]
pub struct RiskRow {
    pub id: String,
    pub sd: String,
    pub sgg: String,
    pub date: String,
    pub risk: f64,
    pub value: f64,
    pub grade: f64,
    pub base_date: String,
    pub publication: String,
    pub fetched_at: f64,
    pub expire_at: f64,
}
fn date_key(ms: f64) -> Option<String> {
    let p = crate::world::js::parts(ms)?;
    Some(format!("{:04}{:02}{:02}", p.year, p.month, p.day))
}
fn today(now_ms: f64) -> Option<String> {
    date_key(now_ms + 9. * HOUR_MS)
}
/// `dayMs(key)`: UTC midnight of a real `YYYYMMDD` string.
fn day_ms(key: &Value) -> Option<f64> {
    let s = key.as_str()?;
    if s.len() != 8 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n = |a: usize, b: usize| s[a..b].parse::<i64>().ok();
    let ms = crate::world::js::days_from_civil(n(0, 4)?, n(4, 6)?, n(6, 8)?) as f64 * DAY_MS;
    (date_key(ms).as_deref() == Some(s)).then_some(ms)
}
/// `publicationMs("YYYY-MM-DDHHMM")`.
fn publication_ms(p: &Value) -> Option<f64> {
    let s = p.as_str()?;
    let b = s.as_bytes();
    let ok = b.len() == 14
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        });
    if !ok {
        return None;
    }
    let day = s[..10].replace('-', "");
    let (hour, minute): (u32, u32) = (s[10..12].parse().ok()?, s[12..14].parse().ok()?);
    if hour > 23 || minute > 59 {
        return None;
    }
    Some(
        day_ms(&Value::String(day))?
            + (f64::from(hour) - 9.) * HOUR_MS
            + f64::from(minute) * 60_000.,
    )
}
/// `grade(risk)`.
pub fn grade(risk: f64) -> f64 {
    if risk < 0.315 {
        0.
    } else if risk < 0.559 {
        1.
    } else if risk < 0.743 {
        2.
    } else {
        3.
    }
}
fn js_trim(s: &str) -> &str {
    s.trim_matches(crate::world::js::is_js_space)
}
/// `parse(body, now)`: the rows to save, or the error legacy throws (nothing is saved).
pub fn parse(body: &Value, now_ms: f64) -> Result<Vec<RiskRow>, &'static str> {
    let data = match (body.get("success"), body.get("data")) {
        (Some(Value::Bool(true)), Some(Value::Array(d))) if !d.is_empty() => d,
        _ => return Err("MFDS invalid response"),
    };
    let today = today(now_ms).ok_or("MFDS invalid response")?;
    let mut seen = std::collections::HashSet::new();
    let mut rows = Vec::new();
    for raw in data {
        let invalid = "MFDS invalid region or publication";
        let sd = match raw.get("sd") {
            Some(Value::String(s)) if !js_trim(s).is_empty() => js_trim(s).to_owned(),
            _ => return Err(invalid),
        };
        let sgg = match raw.get("sgg") {
            Some(Value::Null) => String::new(),
            Some(Value::String(s)) if !js_trim(s).is_empty() => js_trim(s).to_owned(),
            _ => return Err(invalid),
        };
        let base = raw.get("baseDate").unwrap_or(&Value::Null);
        let reg = raw.get("regDatetime").unwrap_or(&Value::Null);
        let (Some(base_ms), Some(reg_ms)) = (day_ms(base), publication_ms(reg)) else {
            return Err(invalid);
        };
        let base = base.as_str().expect("checked").to_owned();
        let reg = reg.as_str().expect("checked").to_owned();
        if base > today || reg_ms > now_ms || reg[..10].replace('-', "") != base {
            return Err(invalid);
        }
        if !seen.insert((sd.clone(), sgg.clone())) {
            return Err("MFDS duplicate region");
        }
        for (offset, field) in ["todayRisk", "tomorrowRisk", "afterTomorrowRisk"]
            .iter()
            .enumerate()
        {
            let Some(risk) = raw.get(*field).and_then(Value::as_f64) else {
                continue;
            };
            if !risk.is_finite() || !(0. ..=1.).contains(&risk) {
                continue;
            }
            let date = date_key(base_ms + offset as f64 * DAY_MS).ok_or(invalid)?;
            if date < today {
                continue;
            }
            let date_ms = day_ms(&Value::String(date.clone())).ok_or(invalid)?;
            let value = crate::world::js::to_fixed(risk * 100., 4)
                .parse::<f64>()
                .unwrap_or(f64::NAN);
            rows.push(RiskRow {
                id: serde_json::to_string(&[&sd, &sgg, &date]).unwrap_or_default(),
                sd: sd.clone(),
                sgg: sgg.clone(),
                date,
                risk,
                value,
                grade: grade(risk),
                base_date: base.clone(),
                publication: reg.clone(),
                fetched_at: now_ms,
                expire_at: date_ms + DAY_MS - 9. * HOUR_MS,
            });
        }
    }
    if rows.is_empty() {
        return Err("MFDS no valid forecast dates");
    }
    Ok(rows)
}
