//! S16 daily summaries and the internal last-year lookup (#2701).
//!
//! AK's O-13 decision authorizes storing daily weather summaries and an internal "same time last
//! year" fallback; no response field, API version or UI exposes them. A summary is the only
//! derived weather value server2 persists (section 6 of `docs/architecture/server2.md`).
//!
//! - [`grid`]: the legacy `getPastMid` day summary (`_getDaySummaryList`) of a requested town,
//!   from the native assembly's inputs at that step; complete with at least 18 valid `t1h` hours.
//! - [`asos`]: a station's daily ASOS row (`policy.normalize`); complete with valid, ordered
//!   minimum and maximum temperatures.
//! - [`vc`]: a Visual Crossing cell's observed local day; complete when temperature covers at
//!   least 75 % of the actual local hours (23/24/25 under DST).
//!
//! Summaries are immutable S3 revisions under `summary/v2/` ([`store`]) written by the
//! post-response [`recorder`] and read by the [`lookup`]. Nothing is ever deleted.
pub mod asos;
pub mod grid;
pub mod lookup;
pub mod recorder;
pub mod store;
pub mod transport;
pub mod vc;

pub use grid::GridInputs;
pub use lookup::{Found, Lookup, LookupError, Target};
pub use recorder::{RecordReport, Recorder, SummarySink};
pub use store::{Stored, SummaryStore};
pub use transport::SummaryTransport;

use crate::domestic::publication::Publication;
use crate::gateway::OrderedJson;
use std::collections::BTreeMap;

/// Body schema version.
pub const SCHEMA: u32 = 1;
/// The minimum valid grid `t1h` hours of a complete day (of 24).
pub const GRID_MIN_HOURS: f64 = 18.;
const HOUR_MS: i64 = 3_600_000;
const DAY_MS: i64 = 24 * HOUR_MS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Source {
    Grid,
    Asos,
    Vc,
}
impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Grid => "grid",
            Self::Asos => "asos",
            Self::Vc => "vc",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "grid" => Some(Self::Grid),
            "asos" => Some(Self::Asos),
            "vc" => Some(Self::Vc),
            _ => None,
        }
    }
}

/// The location a summary belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum SummaryKey {
    /// A town of the KMA town list (`town.first/second/third`). Grid answers depend on the
    /// town's stations, so towns sharing a grid keep separate summaries.
    Grid { town: [String; 3] },
    /// A canonical legacy ASOS station id (`policy.station`).
    Asos { station: String },
    /// The S11 0.02-degree cell in hundredths of a degree.
    Vc { lat: i16, lon: i16 },
}
impl SummaryKey {
    pub fn source(&self) -> Source {
        match self {
            Self::Grid { .. } => Source::Grid,
            Self::Asos { .. } => Source::Asos,
            Self::Vc { .. } => Source::Vc,
        }
    }
    pub fn vc(cell: crate::world::Cell) -> Self {
        Self::Vc {
            lat: (cell.lat * 100.).round() as i16,
            lon: (cell.lon * 100.).round() as i16,
        }
    }
    /// Canonical key JSON (fixed member order).
    pub fn json(&self) -> OrderedJson {
        let s = |v: &str| OrderedJson::String(v.encode_utf16().collect());
        let mut members = vec![(u("source"), s(self.source().as_str()))];
        match self {
            Self::Grid { town } => members.push((
                u("town"),
                OrderedJson::Array(town.iter().map(|t| s(t)).collect()),
            )),
            Self::Asos { station } => members.push((u("station"), s(station))),
            Self::Vc { lat, lon } => members.push((
                u("cell"),
                OrderedJson::Array(vec![
                    OrderedJson::Number(f64::from(*lat)),
                    OrderedJson::Number(f64::from(*lon)),
                ]),
            )),
        }
        OrderedJson::Object(members)
    }
    pub fn sha256(&self) -> String {
        crate::storage::sha256(&self.json().to_bytes())
    }
    /// `summary/v2/{source}/{key_sha256}/{YYYYMMDD}/`.
    pub fn date_prefix(&self, date: u32) -> String {
        format!(
            "{}{}/{}/{date:08}/",
            transport::PREFIX,
            self.source().as_str(),
            self.sha256()
        )
    }
    fn from_json(v: &serde_json::Value) -> Option<Self> {
        let o = v.as_object()?;
        let source = Source::parse(o.get("source")?.as_str()?)?;
        let key = match source {
            Source::Grid => {
                let t = o.get("town")?.as_array()?;
                let t: Vec<String> = t
                    .iter()
                    .map(|x| x.as_str().map(str::to_owned))
                    .collect::<Option<_>>()?;
                Self::Grid {
                    town: t.try_into().ok()?,
                }
            }
            Source::Asos => Self::Asos {
                station: o.get("station")?.as_str()?.to_owned(),
            },
            Source::Vc => {
                let c = o.get("cell")?.as_array()?;
                let n = |i: usize| -> Option<i16> { i16::try_from(c.get(i)?.as_i64()?).ok() };
                if c.len() != 2 {
                    return None;
                }
                Self::Vc {
                    lat: n(0)?,
                    lon: n(1)?,
                }
            }
        };
        (o.len() == 2).then_some(key)
    }
}
fn u(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// One input acquisition of a summary: the instants it concerns (KST wall clock as epoch ms,
/// inclusive), its fetch time and content hash.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct InputId {
    pub family: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub fetched_at_ms: u64,
    pub content_sha256: String,
}
impl InputId {
    /// Whether the input concerns KST date `date` (its hours `(00:00, 24:00]`).
    pub fn concerns(&self, date: u32) -> bool {
        let Some(start) = kst_midnight_ms(date) else {
            return false;
        };
        self.start_ms <= start + DAY_MS && self.end_ms > start
    }
    fn line(&self) -> String {
        format!(
            "{}|{}|{}|{}|{}",
            self.family, self.start_ms, self.end_ms, self.fetched_at_ms, self.content_sha256
        )
    }
}
/// The exact input set of one summary revision, recorded by digest (reproducible from the raw
/// records in S3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Inputs {
    pub count: u64,
    pub latest_fetched_ms: u64,
    pub sha256: String,
    pub families: BTreeMap<String, u64>,
}
impl Inputs {
    pub fn of<'a>(ids: impl IntoIterator<Item = &'a InputId>) -> Self {
        let mut ids: Vec<&InputId> = ids.into_iter().collect();
        ids.sort();
        ids.dedup();
        let mut lines = String::new();
        let mut families = BTreeMap::new();
        let mut latest = 0;
        for id in &ids {
            lines.push_str(&id.line());
            lines.push('\n');
            *families.entry(id.family.clone()).or_insert(0) += 1;
            latest = latest.max(id.fetched_at_ms);
        }
        Self {
            count: ids.len() as u64,
            latest_fetched_ms: latest,
            sha256: crate::storage::sha256(lines.as_bytes()),
            families,
        }
    }
    fn json(&self) -> OrderedJson {
        OrderedJson::Object(vec![
            (u("count"), OrderedJson::Number(self.count as f64)),
            (
                u("latestFetchedMs"),
                OrderedJson::Number(self.latest_fetched_ms as f64),
            ),
            (u("sha256"), OrderedJson::String(u(&self.sha256))),
            (
                u("families"),
                OrderedJson::Object(
                    self.families
                        .iter()
                        .map(|(k, v)| (u(k), OrderedJson::Number(*v as f64)))
                        .collect(),
                ),
            ),
        ])
    }
    fn from_json(v: &serde_json::Value) -> Option<Self> {
        let o = v.as_object()?;
        let n = |k: &str| o.get(k)?.as_u64();
        let mut families = BTreeMap::new();
        for (k, v) in o.get("families")?.as_object()? {
            families.insert(k.clone(), v.as_u64()?);
        }
        let sha = o.get("sha256")?.as_str()?;
        (o.len() == 4 && sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit())).then(|| {
            Self {
                count: n("count").unwrap_or(u64::MAX),
                latest_fetched_ms: n("latestFetchedMs").unwrap_or(u64::MAX),
                sha256: sha.to_owned(),
                families,
            }
        })
    }
}

/// One complete daily summary.
#[derive(Debug, Clone, PartialEq)]
pub struct Summary {
    pub key: SummaryKey,
    /// KST (grid, ASOS) or provider-local (VC) date `YYYYMMDD`.
    pub date: u32,
    /// The grid cell of a grid summary.
    pub grid: Option<(u16, u16)>,
    pub values: OrderedJson,
    pub inputs: Inputs,
}
impl Summary {
    /// The canonical body (fixed member order).
    pub fn body(&self) -> Vec<u8> {
        let mut members = vec![
            (u("schema"), OrderedJson::Number(f64::from(SCHEMA))),
            (
                u("source"),
                OrderedJson::String(u(self.key.source().as_str())),
            ),
            (u("key"), self.key.json()),
            (
                u("date"),
                OrderedJson::String(u(&format!("{:08}", self.date))),
            ),
        ];
        if let Some((nx, ny)) = self.grid {
            members.push((
                u("grid"),
                OrderedJson::Object(vec![
                    (u("nx"), OrderedJson::Number(f64::from(nx))),
                    (u("ny"), OrderedJson::Number(f64::from(ny))),
                ]),
            ));
        }
        members.push((u("values"), self.values.clone()));
        members.push((u("inputs"), self.inputs.json()));
        OrderedJson::Object(members).to_bytes()
    }
    pub fn revision_sha256(&self) -> String {
        crate::storage::sha256(&self.body())
    }
    pub fn values_sha256(&self) -> String {
        crate::storage::sha256(&self.values.to_bytes())
    }
    /// `{latestFetchedMs:013}-{count:06}-{revision_sha256}.json`: names sort by newest input,
    /// then input count.
    pub fn object_name(&self) -> String {
        format!(
            "{:013}-{:06}-{}.json",
            self.inputs.latest_fetched_ms.min(9_999_999_999_999),
            self.inputs.count.min(999_999),
            self.revision_sha256()
        )
    }
    pub fn object_key(&self) -> String {
        format!("{}{}", self.key.date_prefix(self.date), self.object_name())
    }
    /// A stored body, verified against its object name, key and date; None when it does not
    /// verify or is not complete.
    pub fn parse(bytes: &[u8], key: &SummaryKey, date: u32, name: &str) -> Option<Self> {
        let parsed = ObjectName::parse(name)?;
        if crate::storage::sha256(bytes) != parsed.revision {
            return None;
        }
        let v: serde_json::Value = serde_json::from_slice(bytes).ok()?;
        let o = v.as_object()?;
        if o.get("schema")?.as_u64()? != u64::from(SCHEMA)
            || o.get("source")?.as_str()? != key.source().as_str()
            || SummaryKey::from_json(o.get("key")?)? != *key
            || o.get("date")?.as_str()? != format!("{date:08}")
        {
            return None;
        }
        let grid = match o.get("grid") {
            None => None,
            Some(g) => Some((
                u16::try_from(g.get("nx")?.as_u64()?).ok()?,
                u16::try_from(g.get("ny")?.as_u64()?).ok()?,
            )),
        };
        let inputs = Inputs::from_json(o.get("inputs")?)?;
        if inputs.latest_fetched_ms != parsed.latest || inputs.count != parsed.count {
            return None;
        }
        // Member order is kept by the ordered parser for the values.
        let ordered = OrderedJson::parse(bytes).ok()?;
        let values = ordered.get("values")?.clone();
        let summary = Self {
            key: key.clone(),
            date,
            grid,
            values,
            inputs,
        };
        (summary.body() == bytes && complete(key.source(), &summary.values)).then_some(summary)
    }
    /// A number member of the values.
    pub fn value(&self, name: &str) -> Option<f64> {
        self.values.get(name).and_then(OrderedJson::number)
    }
}
/// A parsed object name.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct ObjectName {
    pub latest: u64,
    pub count: u64,
    pub revision: String,
}
impl ObjectName {
    pub fn parse(name: &str) -> Option<Self> {
        let stem = name.strip_suffix(".json")?;
        let mut parts = stem.split('-');
        let (a, b, c) = (parts.next()?, parts.next()?, parts.next()?);
        let digits = |s: &str, n: usize| s.len() == n && s.bytes().all(|b| b.is_ascii_digit());
        let hex = c.len() == 64
            && c.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        (parts.next().is_none() && digits(a, 13) && digits(b, 6) && hex).then(|| Self {
            latest: a.parse().unwrap_or(0),
            count: b.parse().unwrap_or(0),
            revision: c.to_owned(),
        })
    }
}

/// The completeness rule of each source over stored values.
pub fn complete(source: Source, values: &OrderedJson) -> bool {
    let n = |k: &str| values.get(k).and_then(OrderedJson::number);
    match source {
        Source::Grid => {
            n("observationHours").is_some_and(|h| h >= GRID_MIN_HOURS)
                && n("taMin").is_some()
                && n("taMax").is_some()
        }
        Source::Asos => match (n("taMin"), n("taMax")) {
            (Some(lo), Some(hi)) => {
                let valid = |f: &str, x: f64| {
                    crate::domestic::kma::policy::valid(f, &crate::domestic::kma::js::V::Num(x))
                };
                valid("taMin", lo) && valid("taMax", hi) && lo <= hi
            }
            _ => false,
        },
        Source::Vc => match (n("observationHours"), n("localHours")) {
            (Some(h), Some(l)) => {
                (23. ..=25.).contains(&l) && h <= l && h * 4. >= l * 3. && n("taMin").is_some()
            }
            _ => false,
        },
    }
}

/// Epoch ms of KST midnight starting `date` (`YYYYMMDD`).
pub fn kst_midnight_ms(date: u32) -> Option<i64> {
    Publication::new(date, 0).map(crate::history::schedule::to_ms)
}
/// The KST date `days` after `date`.
pub fn add_days(date: u32, days: i64) -> Option<u32> {
    Publication::new(date, 0)?
        .add_hours(days * 24)
        .map(Publication::date)
}
/// The KST date of an instant.
pub fn kst_date(ms: f64) -> u32 {
    crate::history::schedule::from_ms(ms as i64).date()
}
