//! Rolling-horizon Korean 24 solar-term calendar with atomic immutable year snapshots.

use super::astro::{self, ALGORITHM};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};

pub const KST_OFFSET_MS: i64 = 9 * 3_600_000;
pub const DAY_MS: i64 = 86_400_000;
pub const DEFAULT_FUTURE_YEARS: i32 = 20;
pub const MAX_FUTURE_YEARS: i32 = 50;

pub const NAMES: [&str; 24] = [
    "소한", "대한", "입춘", "우수", "경칩", "춘분", "청명", "곡우", "입하", "소만", "망종", "하지",
    "소서", "대서", "입추", "처서", "백로", "추분", "한로", "상강", "입동", "소설", "대설", "동지",
];

pub const BUNDLED_SEEDS_JSON: &str = include_str!("data/published.json");

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalculatedTerm {
    pub id: String,
    pub name_ko: String,
    pub utc_ms: i64,
    pub date: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermEntry {
    pub id: String,
    pub name_ko: String,
    pub date: String,
    pub corrected: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialEdition {
    pub id: String,
    pub source_url: String,
    pub publication_date: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditionRecord {
    pub year: i32,
    pub id: String,
    pub publication_date: String,
    pub order: String,
    pub source_url: String,
    pub source_digest: String,
    pub dates: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Calculated,
    Verified,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YearSnapshot {
    pub year: i32,
    pub time_zone: String,
    pub status: Status,
    pub official_edition: Option<OfficialEdition>,
    pub terms: Vec<TermEntry>,
    pub revision: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CalendarError(pub String);

impl std::fmt::Display for CalendarError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for CalendarError {}

pub fn valid_horizon(years: i32) -> bool {
    (DEFAULT_FUTURE_YEARS..=MAX_FUTURE_YEARS).contains(&years)
}

pub fn future_years_from_var(var: &dyn Fn(&str) -> Option<String>) -> (i32, bool) {
    match var("SOLAR_TERMS_FUTURE_YEARS") {
        None => (DEFAULT_FUTURE_YEARS, false),
        Some(raw) => match raw.trim().parse::<i32>() {
            Ok(v) if valid_horizon(v) => (v, false),
            _ => (DEFAULT_FUTURE_YEARS, true),
        },
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(64);
    for b in digest {
        use std::fmt::Write;
        let _ = write!(&mut out, "{b:02x}");
    }
    out
}

pub fn korea_date(utc_ms: i64) -> String {
    let kst_secs = (utc_ms + KST_OFFSET_MS).div_euclid(1000);
    let dt = time::OffsetDateTime::from_unix_timestamp(kst_secs)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    format!(
        "{:04}-{:02}-{:02}",
        dt.year(),
        u8::from(dt.month()),
        dt.day()
    )
}

pub fn kst_year_month(utc_ms: i64) -> (i32, u8) {
    let kst_secs = (utc_ms + KST_OFFSET_MS).div_euclid(1000);
    let dt = time::OffsetDateTime::from_unix_timestamp(kst_secs)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    (dt.year(), u8::from(dt.month()))
}

pub fn check_years(utc_ms: i64) -> Vec<i32> {
    let (year, month) = kst_year_month(utc_ms);
    if month >= 6 {
        vec![year, year + 1]
    } else {
        vec![year]
    }
}

pub fn iso_date(year: i32, month: u8, day: u8) -> Result<String, CalendarError> {
    let m = time::Month::try_from(month).map_err(|_| CalendarError("Invalid civil date".into()))?;
    let d = time::Date::from_calendar_date(year, m, day)
        .map_err(|_| CalendarError("Invalid civil date".into()))?;
    Ok(format!(
        "{:04}-{:02}-{:02}",
        d.year(),
        u8::from(d.month()),
        d.day()
    ))
}

pub fn parse_iso_date(s: &str) -> Result<(i32, u8, u8), CalendarError> {
    let bytes = s.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return Err(CalendarError("Invalid civil date".into()));
    }
    if !bytes[..4].iter().all(u8::is_ascii_digit)
        || !bytes[5..7].iter().all(u8::is_ascii_digit)
        || !bytes[8..10].iter().all(u8::is_ascii_digit)
    {
        return Err(CalendarError("Invalid civil date".into()));
    }
    let year: i32 = s[0..4]
        .parse()
        .map_err(|_| CalendarError("Invalid civil date".into()))?;
    let month: u8 = s[5..7]
        .parse()
        .map_err(|_| CalendarError("Invalid civil date".into()))?;
    let day: u8 = s[8..10]
        .parse()
        .map_err(|_| CalendarError("Invalid civil date".into()))?;
    let canonical = iso_date(year, month, day)?;
    if canonical != s {
        return Err(CalendarError("Invalid civil date".into()));
    }
    Ok((year, month, day))
}

/// Start of KST civil day `YYYY-MM-DD` as UTC Unix ms.
pub fn kst_midnight_ms(iso: &str) -> Option<i64> {
    let (y, m, d) = parse_iso_date(iso).ok()?;
    let month = time::Month::try_from(m).ok()?;
    let date = time::Date::from_calendar_date(y, month, d).ok()?;
    let utc_secs = date.midnight().assume_utc().unix_timestamp();
    Some(utc_secs * 1000 - KST_OFFSET_MS)
}

pub fn format_utc_iso(utc_ms: i64) -> String {
    let secs = utc_ms.div_euclid(1000);
    let ms = utc_ms.rem_euclid(1000);
    let dt =
        time::OffsetDateTime::from_unix_timestamp(secs).unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        dt.year(),
        u8::from(dt.month()),
        dt.day(),
        dt.hour(),
        dt.minute(),
        dt.second(),
        ms
    )
}

/// Minutes from KST midnight (`min(minute_of_day, 1440 - minute_of_day)`).
pub fn minutes_from_kst_midnight(utc_ms: i64) -> f64 {
    let kst_ms = (utc_ms + KST_OFFSET_MS).rem_euclid(DAY_MS);
    let mins = (kst_ms as f64) / 60_000.0;
    mins.min(1440.0 - mins)
}

/// Calculate all 24 solar-term crossings for a Korean civil year.
pub fn calculate(year: i32) -> Result<Vec<CalculatedTerm>, CalendarError> {
    let mut out = Vec::with_capacity(24);
    for (i, &name_ko) in NAMES.iter().enumerate() {
        let longitude = (285 + i * 15) % 360;
        let month = (i / 2 + 1) as u8;
        let day = if i % 2 == 1 { 15u8 } else { 1u8 };
        let m = time::Month::try_from(month)
            .map_err(|_| CalendarError("invalid calculation month".into()))?;
        let d = time::Date::from_calendar_date(year, m, day)
            .map_err(|_| CalendarError("invalid calculation date".into()))?;
        let start_ms = (d.midnight().assume_utc().unix_timestamp() * 1000 - KST_OFFSET_MS) as f64;
        let hit_ms = astro::search_sun_longitude(longitude as f64, start_ms, 13.0)
            .ok_or_else(|| CalendarError(format!("Missing solar longitude crossing for {year}")))?;
        out.push(CalculatedTerm {
            id: format!("solar-{longitude}"),
            name_ko: name_ko.to_owned(),
            utc_ms: hit_ms,
            date: korea_date(hit_ms),
        });
    }
    Ok(out)
}

pub fn validate_edition(e: &EditionRecord) -> Result<(), CalendarError> {
    if e.year < 1900 || e.year > 3000 || e.dates.len() != 24 {
        return Err(CalendarError("Incomplete official almanac".into()));
    }
    if e.source_digest.len() != 64
        || !e
            .source_digest
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Err(CalendarError("Incomplete official almanac".into()));
    }
    let Some((id_year, id_serial)) = e.id.split_once('-') else {
        return Err(CalendarError("Incomplete official almanac".into()));
    };
    if id_year.len() != 4
        || !id_year.bytes().all(|b| b.is_ascii_digit())
        || id_serial.is_empty()
        || !id_serial.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(CalendarError("Incomplete official almanac".into()));
    }
    let (pub_year, _, _) = parse_iso_date(&e.publication_date)
        .map_err(|_| CalendarError("Invalid official edition identity".into()))?;
    if id_year != format!("{pub_year:04}") {
        return Err(CalendarError("Invalid official edition identity".into()));
    }
    let padded_serial = format!("{id_serial:0>9}");
    let expected_order = format!("{}/{padded_serial}", e.publication_date);
    if e.order != expected_order {
        return Err(CalendarError("Invalid official edition identity".into()));
    }
    if !is_valid_gazette_url(&e.source_url) {
        return Err(CalendarError("Invalid official edition identity".into()));
    }
    for (i, date) in e.dates.iter().enumerate() {
        let (y, m, _) = parse_iso_date(date)
            .map_err(|_| CalendarError("Invalid official term dates".into()))?;
        if y != e.year || usize::from(m) != (i / 2) + 1 {
            return Err(CalendarError("Invalid official term dates".into()));
        }
        if i > 0 && date <= &e.dates[i - 1] {
            return Err(CalendarError("Invalid official term dates".into()));
        }
    }
    Ok(())
}

pub fn is_valid_gazette_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://www.gwanbo.go.kr/ezpdf/customLayout.jsp?contentId=")
    else {
        return false;
    };
    let Some((content, rest)) = rest.split_once("&tocId=") else {
        return false;
    };
    let Some(toc) = rest.strip_suffix("&isTocOrder=N") else {
        return false;
    };
    is_gazette_id(content) && is_gazette_id(toc)
}

pub fn is_gazette_id(s: &str) -> bool {
    let Some(digits) = s.strip_prefix('I') else {
        return false;
    };
    !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
}

pub fn bundled_seeds() -> Result<Vec<EditionRecord>, CalendarError> {
    let seeds: Vec<EditionRecord> = serde_json::from_str(BUNDLED_SEEDS_JSON)
        .map_err(|e| CalendarError(format!("invalid bundled seeds: {e}")))?;
    for seed in &seeds {
        validate_edition(seed)?;
    }
    Ok(seeds)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RevisionBody<'a> {
    year: i32,
    time_zone: &'a str,
    status: Status,
    official_edition: Option<&'a OfficialEdition>,
    terms: &'a [TermEntry],
}

pub fn build_year(
    year: i32,
    baseline: &[CalculatedTerm],
    edition: Option<&EditionRecord>,
) -> YearSnapshot {
    let terms: Vec<TermEntry> = baseline
        .iter()
        .enumerate()
        .map(|(i, base)| {
            let date = edition
                .map(|e| e.dates[i].clone())
                .unwrap_or_else(|| base.date.clone());
            let corrected = date != base.date;
            TermEntry {
                id: base.id.clone(),
                name_ko: base.name_ko.clone(),
                date,
                corrected,
            }
        })
        .collect();
    let official_edition = edition.map(|e| OfficialEdition {
        id: e.id.clone(),
        source_url: e.source_url.clone(),
        publication_date: e.publication_date.clone(),
    });
    let status = if edition.is_some() {
        Status::Verified
    } else {
        Status::Calculated
    };
    let rev_body = RevisionBody {
        year,
        time_zone: "Asia/Seoul",
        status,
        official_edition: official_edition.as_ref(),
        terms: &terms,
    };
    let digest_input = serde_json::to_vec(&(
        ALGORITHM,
        edition.map(|e| e.source_digest.as_str()),
        &rev_body,
    ))
    .expect("revision serialization");
    let revision = sha256_hex(&digest_input);
    YearSnapshot {
        year,
        time_zone: "Asia/Seoul".to_owned(),
        status,
        official_edition,
        terms,
        revision,
    }
}

struct YearRecord {
    baseline: Vec<CalculatedTerm>,
    active: Arc<YearSnapshot>,
    edition: Option<EditionRecord>,
}

struct State {
    records: BTreeMap<i32, YearRecord>,
    restoring: bool,
}

pub type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

pub fn system_clock() -> Clock {
    Arc::new(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis().min(i64::MAX as u128) as i64)
    })
}

pub struct Calendar {
    clock: Clock,
    future_years: i32,
    state: RwLock<State>,
}

impl Calendar {
    pub fn new(
        clock: Clock,
        future_years: i32,
        seeds: &[EditionRecord],
    ) -> Result<Self, CalendarError> {
        if !valid_horizon(future_years) {
            return Err(CalendarError("Invalid solar-term horizon".into()));
        }
        let cal = Self {
            clock,
            future_years,
            state: RwLock::new(State {
                records: BTreeMap::new(),
                restoring: false,
            }),
        };
        cal.prepare()?;
        for seed in seeds {
            cal.apply(seed.clone())?;
        }
        Ok(cal)
    }

    pub fn current_year(&self) -> i32 {
        kst_year_month((self.clock)()).0
    }

    pub fn now_ms(&self) -> i64 {
        (self.clock)()
    }

    pub fn future_years(&self) -> i32 {
        self.future_years
    }

    pub fn in_range(&self, year: i32) -> bool {
        let first = self.current_year();
        year >= first && year <= first + self.future_years
    }

    /// Stage current year through `current + future_years + 1` so KST New Year rollover has no gap.
    pub fn prepare(&self) -> Result<(), CalendarError> {
        let first = self.current_year();
        let last = first + self.future_years + 1;
        let missing: Vec<i32> = {
            let guard = self.state.read().expect("calendar lock");
            (first..=last)
                .filter(|y| !guard.records.contains_key(y))
                .collect()
        };
        let mut computed = Vec::with_capacity(missing.len());
        for y in missing {
            let baseline = calculate(y)?;
            let active = Arc::new(build_year(y, &baseline, None));
            computed.push((
                y,
                YearRecord {
                    baseline,
                    active,
                    edition: None,
                },
            ));
        }
        let mut guard = self.state.write().expect("calendar lock");
        for (y, rec) in computed {
            guard.records.entry(y).or_insert(rec);
        }
        guard.records.retain(|&y, _| y >= first);
        Ok(())
    }

    /// Validate `edition` and reject any same-`(year, order)` conflict against currently loaded
    /// editions (including bundled cold-start seeds) without mutating calendar state.
    pub fn check_edition(&self, edition: &EditionRecord) -> Result<(), CalendarError> {
        validate_edition(edition)?;
        let guard = self.state.read().expect("calendar lock");
        if let Some(record) = guard.records.get(&edition.year)
            && let Some(prev) = &record.edition
            && edition.order == prev.order
            && (edition.source_digest != prev.source_digest || edition.dates != prev.dates)
        {
            return Err(CalendarError("Conflicting same-version almanac".into()));
        }
        Ok(())
    }

    pub fn apply(&self, edition: EditionRecord) -> Result<(), CalendarError> {
        validate_edition(&edition)?;
        let mut guard = self.state.write().expect("calendar lock");
        let Some(record) = guard.records.get_mut(&edition.year) else {
            return Ok(());
        };
        if let Some(prev) = &record.edition {
            if edition.order < prev.order {
                return Ok(());
            }
            if edition.order == prev.order {
                if edition.source_digest != prev.source_digest || edition.dates != prev.dates {
                    return Err(CalendarError("Conflicting same-version almanac".into()));
                }
                return Ok(());
            }
        }
        let active = Arc::new(build_year(edition.year, &record.baseline, Some(&edition)));
        record.active = active;
        record.edition = Some(edition);
        Ok(())
    }

    pub fn read_year(&self, year: i32) -> Option<Arc<YearSnapshot>> {
        let first = self.current_year();
        if year < first || year > first + self.future_years {
            return None;
        }
        let guard = self.state.read().expect("calendar lock");
        if guard.restoring && year <= first + 1 {
            return None;
        }
        guard.records.get(&year).map(|r| Arc::clone(&r.active))
    }

    pub fn term_for_kst_date(&self, iso_date: &str) -> Option<(TermEntry, String)> {
        let (year, _, _) = parse_iso_date(iso_date).ok()?;
        let snapshot = self.read_year(year)?;
        let term = snapshot.terms.iter().find(|t| t.date == iso_date)?.clone();
        Some((term, snapshot.revision.clone()))
    }

    pub fn begin_restore(&self) {
        self.state.write().expect("calendar lock").restoring = true;
    }

    pub fn finish_restore(&self) {
        self.state.write().expect("calendar lock").restoring = false;
    }

    pub fn is_restoring(&self) -> bool {
        self.state.read().expect("calendar lock").restoring
    }
}
