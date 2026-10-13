//! Legacy history export import. Seeds come from the offline converter
//! `tools/migration/export_history_seeds.py`; every seed group (one collection and key) becomes
//! one immutable raw record that keeps the original `mongoexport` lines byte for byte, with
//! provenance in the manifest line. Each export instant is a separate revision.
//! Also reproduces the legacy read projection of current rows and the station-minute window.
use super::{Grid, capture::Publisher, schedule};
use crate::domestic::publication::Publication;
use crate::resolver::Acquisition;
use crate::storage::{
    CatalogId, CatalogLimits, GroupDeclaration, GroupMember, ProviderKey, RawRecord, sha256,
};
use serde::Deserialize;
use serde_json::Value;
use std::{collections::BTreeSet, fmt, sync::Arc};
use tokio::time::Instant;

pub const SOURCE: &str = "legacy-mongo";
const HOUR_MS: i64 = 3_600_000;
const SEED_BYTES: usize = 64 * 1024 * 1024;
const GROUP_DOCUMENTS: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LegacyError {
    Invalid(&'static str),
    Storage(crate::storage::Error),
}
impl fmt::Display for LegacyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "legacy history: {self:?}")
    }
}
impl std::error::Error for LegacyError {}
impl From<crate::storage::Error> for LegacyError {
    fn from(e: crate::storage::Error) -> Self {
        Self::Storage(e)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum LegacyKind {
    TownCurrent,
    TownShortest,
    TownShort,
    CurrentV1,
    ShortestV1,
    ShortV1,
    StnHourly2,
    StnMinute2,
}
impl LegacyKind {
    pub const ALL: [LegacyKind; 8] = [
        Self::TownCurrent,
        Self::TownShortest,
        Self::TownShort,
        Self::CurrentV1,
        Self::ShortestV1,
        Self::ShortV1,
        Self::StnHourly2,
        Self::StnMinute2,
    ];
    /// Mongoose model name, as the converter's `--collection`.
    pub fn collection(self) -> &'static str {
        match self {
            Self::TownCurrent => "kma.town.current",
            Self::TownShortest => "kma.town.shortest",
            Self::TownShort => "kma.town.short",
            Self::CurrentV1 => "current",
            Self::ShortestV1 => "shortest",
            Self::ShortV1 => "short",
            Self::StnHourly2 => "KmaStnHourly2",
            Self::StnMinute2 => "KmaStnMinute2",
        }
    }
    /// Raw record kind under source `legacy-mongo`.
    pub fn kind(self) -> &'static str {
        match self {
            Self::TownCurrent => "kma-town-current",
            Self::TownShortest => "kma-town-shortest",
            Self::TownShort => "kma-town-short",
            Self::CurrentV1 => "current-v1",
            Self::ShortestV1 => "shortest-v1",
            Self::ShortV1 => "short-v1",
            Self::StnHourly2 => "kma-stn-hourly2",
            Self::StnMinute2 => "kma-stn-minute2",
        }
    }
    pub fn from_collection(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.collection() == name)
    }
    /// Required `DB_DATA_VERSION`; station collections exist in both.
    fn db_version_ok(self, version: &str) -> bool {
        match self {
            Self::TownCurrent | Self::TownShortest | Self::TownShort => version == "2.0",
            Self::CurrentV1 | Self::ShortestV1 | Self::ShortV1 => version == "1.0",
            Self::StnHourly2 | Self::StnMinute2 => matches!(version, "1.0" | "2.0"),
        }
    }
    fn station(self) -> bool {
        matches!(self, Self::StnHourly2 | Self::StnMinute2)
    }
    fn v1(self) -> bool {
        matches!(self, Self::CurrentV1 | Self::ShortestV1 | Self::ShortV1)
    }
    fn data_key(self) -> &'static str {
        match self {
            Self::TownCurrent | Self::CurrentV1 => "currentData",
            Self::TownShortest | Self::ShortestV1 => "shortestData",
            Self::TownShort | Self::ShortV1 => "shortData",
            Self::StnHourly2 | Self::StnMinute2 => "",
        }
    }
    fn row_fields(self) -> &'static [&'static str] {
        match self {
            Self::TownCurrent | Self::CurrentV1 => CURRENT_ROW,
            Self::TownShortest | Self::ShortestV1 => SHORTEST_ROW,
            Self::TownShort | Self::ShortV1 => SHORT_ROW,
            Self::StnHourly2 | Self::StnMinute2 => STATION_FIELDS,
        }
    }
}
// Legacy schemas at 47a96078: server/models/{modelCurrent,modelShortest,modelShort,
// modelKmaStnHourly2,modelKmaStnMinute2}.js and server/models/kma/kma.town.*.model.js.
const CURRENT_ROW: &[&str] = &[
    "date", "time", "mx", "my", "t1h", "rn1", "sky", "uuu", "vvv", "reh", "pty", "lgt", "vec",
    "wsd",
];
const SHORTEST_ROW: &[&str] = &[
    "date", "time", "mx", "my", "pty", "rn1", "rn1Text", "sky", "lgt", "pop", "t1h", "reh", "uuu",
    "vvv", "vec", "wsd",
];
const SHORT_ROW: &[&str] = &[
    "date", "time", "mx", "my", "pop", "pty", "r06", "r06Text", "reh", "s06", "s06Text", "sky",
    "t3h", "tmn", "tmx", "uuu", "vvv", "wav", "vec", "wsd",
];
const DAILY_SOURCE_ROW: &[&str] = &[
    "date", "time", "t3h", "tmn", "tmx", "sky", "pty", "reh", "pop", "wsd",
];
const STATION_FIELDS: &[&str] = &[
    "stnId",
    "stnName",
    "date",
    "weather",
    "visibility",
    "cloud",
    "heavyCloud",
    "t1h",
    "dpt",
    "sensoryTem",
    "dspls",
    "r1d",
    "s1d",
    "reh",
    "wdd",
    "vec",
    "wsd",
    "hPa",
    "rs1h",
    "rs1d",
    "rs15m",
    "rns",
];
/// Legacy `app.js` `commonString` + `curString` projection order.
const CURRENT_PROJECTION: &[&str] = &[
    "date", "time", "t1h", "rn1", "sky", "uuu", "vvv", "reh", "pty", "lgt", "vec", "wsd",
];

/// How far before an export instant the legacy store still holds a family's publications.
pub fn retention_ms(family: schedule::Family) -> i64 {
    match family {
        schedule::Family::AwsHourly | schedule::Family::CityObs => 10 * 24 * HOUR_MS,
        schedule::Family::AwsMinute => 24 * HOUR_MS,
        // v1 arrays keep 192 slots; v2 rows 216 h. The shorter bound is used.
        _ => 191 * HOUR_MS,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ExportKey {
    Grid(Grid),
    Station(u32),
}
impl ExportKey {
    pub fn provider_key(self) -> ProviderKey {
        match self {
            Self::Grid(g) => g.provider_key(),
            Self::Station(id) => ProviderKey::Station { id: id.to_string() },
        }
    }
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum WireKey {
    Grid { nx: u16, ny: u16 },
    Station { id: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct WireManifest {
    schema: u8,
    tool: String,
    collection: String,
    #[serde(rename = "dbVersion")]
    db_version: String,
    #[serde(rename = "exportedAt")]
    exported_at: String,
    #[serde(rename = "sourceSha256")]
    source_sha256: String,
    documents: u64,
    groups: u64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeedManifest {
    pub collection: String,
    pub db_version: String,
    pub exported_at_ms: u64,
    pub source_sha256: String,
    pub documents: usize,
    pub groups: usize,
}
#[derive(Debug, Clone)]
pub struct SeedGroup {
    pub key: ExportKey,
    pub documents: usize,
    line: Arc<[u8]>,
}
#[derive(Debug, Clone)]
pub struct SeedFile {
    pub manifest: SeedManifest,
    pub kind: LegacyKind,
    pub groups: Vec<SeedGroup>,
    manifest_line: Arc<[u8]>,
}
/// A stored export record parsed back: provenance, key, original line numbers and documents.
#[derive(Debug, Clone)]
pub struct ExportRecord {
    pub manifest: SeedManifest,
    pub kind: LegacyKind,
    pub key: ExportKey,
    pub lines: Vec<u64>,
    pub documents: Vec<Vec<u8>>,
}

/// Parse and validate a whole seed file (JSON Lines, `\n` only).
pub fn parse_seed(bytes: &[u8]) -> Result<SeedFile, LegacyError> {
    let seed = parse_lines(bytes)?;
    let documents: usize = seed.groups.iter().map(|g| g.documents).sum();
    if seed.groups.len() != seed.manifest.groups || documents != seed.manifest.documents {
        return Err(LegacyError::Invalid("seed counts"));
    }
    Ok(seed)
}
/// Manifest plus validated group lines; counts are checked by the caller.
fn parse_lines(bytes: &[u8]) -> Result<SeedFile, LegacyError> {
    if bytes.is_empty()
        || bytes.len() > SEED_BYTES
        || bytes.contains(&b'\r')
        || !bytes.ends_with(b"\n")
    {
        return Err(LegacyError::Invalid("seed framing"));
    }
    let mut lines = bytes[..bytes.len() - 1].split(|b| *b == b'\n');
    let manifest_line = lines.next().ok_or(LegacyError::Invalid("seed manifest"))?;
    let (manifest, kind) = manifest(manifest_line)?;
    let mut groups = Vec::new();
    let mut keys = BTreeSet::new();
    for line in lines {
        let ParsedGroup { key, docs, .. } = group(kind, line)?;
        if !keys.insert(key) {
            return Err(LegacyError::Invalid("duplicate seed key"));
        }
        groups.push(SeedGroup {
            key,
            documents: docs.len(),
            line: Arc::from(line),
        });
    }
    if groups.is_empty() {
        return Err(LegacyError::Invalid("seed counts"));
    }
    Ok(SeedFile {
        manifest,
        kind,
        groups,
        manifest_line: Arc::from(manifest_line),
    })
}
fn manifest(line: &[u8]) -> Result<(SeedManifest, LegacyKind), LegacyError> {
    let invalid = LegacyError::Invalid("seed manifest");
    let m: WireManifest = serde_json::from_slice(line).map_err(|_| invalid.clone())?;
    let kind = LegacyKind::from_collection(&m.collection).ok_or(invalid.clone())?;
    let exported_at_ms = parse_iso(&m.exported_at)
        .and_then(|ms| u64::try_from(ms).ok())
        .ok_or(invalid.clone())?;
    if m.schema != 1
        || m.tool != "export_history_seeds"
        || !kind.db_version_ok(&m.db_version)
        || m.source_sha256.len() != 64
        || !m
            .source_sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || format_iso(exported_at_ms as i64) != m.exported_at
    {
        return Err(invalid);
    }
    Ok((
        SeedManifest {
            collection: m.collection,
            db_version: m.db_version,
            exported_at_ms,
            source_sha256: m.source_sha256,
            documents: usize::try_from(m.documents).map_err(|_| invalid.clone())?,
            groups: usize::try_from(m.groups).map_err(|_| invalid)?,
        },
        kind,
    ))
}
/// One group line `{"key":K,"lines":[..],"documents":[..]}`; documents are exact slices.
struct ParsedGroup<'a> {
    key: ExportKey,
    lines: Vec<u64>,
    docs: Vec<&'a [u8]>,
}
fn group(kind: LegacyKind, line: &[u8]) -> Result<ParsedGroup<'_>, LegacyError> {
    let invalid = LegacyError::Invalid("seed group");
    let members = members(line).ok_or(invalid.clone())?;
    let names: Vec<&str> = members.iter().map(|(n, _)| n.as_str()).collect();
    if names != ["key", "lines", "documents"] {
        return Err(invalid);
    }
    let key = match serde_json::from_slice::<WireKey>(&line[members[0].1.clone()])
        .map_err(|_| invalid.clone())?
    {
        WireKey::Grid { nx, ny } if !kind.station() => {
            ExportKey::Grid(Grid::new(nx, ny).ok_or(invalid.clone())?)
        }
        WireKey::Station { id } if kind.station() && id > 0 => ExportKey::Station(id),
        _ => return Err(invalid),
    };
    let lines: Vec<u64> =
        serde_json::from_slice(&line[members[1].1.clone()]).map_err(|_| invalid.clone())?;
    let array = &line[members[2].1.clone()];
    let docs: Vec<&[u8]> = elements(array)
        .ok_or(invalid.clone())?
        .into_iter()
        .map(|r| &array[r])
        .collect();
    if docs.is_empty()
        || docs.len() > GROUP_DOCUMENTS
        || docs.len() != lines.len()
        || lines.windows(2).any(|w| w[0] >= w[1])
        || lines.first().is_some_and(|l| *l == 0)
    {
        return Err(invalid);
    }
    for doc in &docs {
        validate_document(kind, key, doc)?;
    }
    Ok(ParsedGroup { key, lines, docs })
}

/// Exactly one JSON value per byte range; strings are scanned with escapes.
fn value_end(b: &[u8], mut i: usize) -> Option<usize> {
    match *b.get(i)? {
        b'"' => {
            i += 1;
            while i < b.len() {
                match b[i] {
                    b'\\' => i += 2,
                    b'"' => return Some(i + 1),
                    _ => i += 1,
                }
            }
            None
        }
        b'{' | b'[' => {
            let mut depth = 0usize;
            while i < b.len() {
                match b[i] {
                    b'"' => {
                        i = value_end(b, i)?;
                        continue;
                    }
                    b'{' | b'[' => depth += 1,
                    b'}' | b']' => {
                        depth -= 1;
                        if depth == 0 {
                            return Some(i + 1);
                        }
                    }
                    _ => {}
                }
                i += 1;
            }
            None
        }
        _ => {
            let start = i;
            while i < b.len() && !matches!(b[i], b',' | b'}' | b']') {
                i += 1;
            }
            (i > start).then_some(i)
        }
    }
}
/// Top-level members of a compact object with their value ranges.
fn members(b: &[u8]) -> Option<Vec<(String, std::ops::Range<usize>)>> {
    if b.first() != Some(&b'{') || value_end(b, 0)? != b.len() {
        return None;
    }
    let mut out = Vec::new();
    let mut i = 1;
    if b.get(i) == Some(&b'}') {
        return Some(out);
    }
    loop {
        let name_end = value_end(b, i)?;
        let name: String = serde_json::from_slice(&b[i..name_end]).ok()?;
        if b.get(name_end) != Some(&b':') {
            return None;
        }
        let start = name_end + 1;
        let end = value_end(b, start)?;
        out.push((name, start..end));
        match b.get(end) {
            Some(b',') => i = end + 1,
            Some(b'}') if end + 1 == b.len() => return Some(out),
            _ => return None,
        }
    }
}
/// Element ranges of a compact array.
fn elements(b: &[u8]) -> Option<Vec<std::ops::Range<usize>>> {
    if b.first() != Some(&b'[') || value_end(b, 0)? != b.len() {
        return None;
    }
    let mut out = Vec::new();
    let mut i = 1;
    if b.get(i) == Some(&b']') {
        return Some(out);
    }
    loop {
        let end = value_end(b, i)?;
        out.push(i..end);
        match b.get(end) {
            Some(b',') => i = end + 1,
            Some(b']') if end + 1 == b.len() => return Some(out),
            _ => return None,
        }
    }
}

fn only_keys(object: &serde_json::Map<String, Value>, allowed: &[&str]) -> bool {
    object
        .keys()
        .all(|k| allowed.contains(&k.as_str()) || k == "_id" || k == "__v")
}
fn oid(v: &Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.len() == 1
            && o.get("$oid")
                .and_then(Value::as_str)
                .is_some_and(|s| s.len() == 24 && s.bytes().all(|b| b.is_ascii_hexdigit()))
    })
}
/// Scalars or one Extended JSON number/date wrapper; nothing nested can hide extra data.
fn scalar(v: &Value) -> bool {
    match v {
        Value::Object(o) => {
            o.len() == 1
                && [
                    "$numberInt",
                    "$numberLong",
                    "$numberDouble",
                    "$numberDecimal",
                    "$date",
                ]
                .iter()
                .any(|k| o.contains_key(*k))
                && (ext_number(v).is_some() || ext_date_ms(v).is_some())
        }
        Value::Array(_) => false,
        _ => true,
    }
}
fn row_ok(row: &Value, fields: &[&str]) -> bool {
    row.as_object().is_some_and(|o| {
        only_keys(o, fields)
            && o.iter().all(|(k, v)| match k.as_str() {
                "_id" => oid(v),
                _ => scalar(v),
            })
    })
}
fn validate_document(kind: LegacyKind, key: ExportKey, doc: &[u8]) -> Result<(), LegacyError> {
    let invalid = LegacyError::Invalid("legacy document");
    let value: Value = serde_json::from_slice(doc).map_err(|_| invalid.clone())?;
    let o = value.as_object().ok_or(invalid.clone())?;
    if o.get("_id").is_some_and(|v| !oid(v))
        || o.get("__v").is_some_and(|v| ext_number(v).is_none())
    {
        return Err(invalid);
    }
    if kind.station() {
        let id = o.get("stnId").and_then(ext_number);
        if !row_ok(&value, STATION_FIELDS)
            || id
                != Some(match key {
                    ExportKey::Station(s) => f64::from(s),
                    ExportKey::Grid(_) => return Err(invalid),
                })
            || o.get("date").and_then(ext_date_ms).is_none()
        {
            return Err(invalid);
        }
        return Ok(());
    }
    let ExportKey::Grid(grid) = key else {
        return Err(invalid);
    };
    let data = kind.data_key();
    let mut top = vec!["mCoord", "pubDate", data];
    if kind.v1() {
        if kind == LegacyKind::ShortV1 {
            top.push("dailySource");
        }
    } else {
        top.push("fcsDate");
    }
    let coord = o.get("mCoord").and_then(Value::as_object);
    let coord_ok = coord.is_some_and(|c| {
        c.len() == 2
            && c.get("mx").and_then(ext_number) == Some(f64::from(grid.nx()))
            && c.get("my").and_then(ext_number) == Some(f64::from(grid.ny()))
    });
    if !only_keys(o, &top) || !coord_ok {
        return Err(invalid);
    }
    if kind.v1() {
        let rows = o
            .get(data)
            .and_then(Value::as_array)
            .ok_or(invalid.clone())?;
        let pub_ok = o.get("pubDate").is_none_or(|v| v.is_string());
        let daily_ok = o.get("dailySource").is_none_or(|d| {
            d.as_object().is_some_and(|d| {
                only_keys(d, &["pubDate", "rows"])
                    && d.get("pubDate").is_none_or(Value::is_string)
                    && d.get("rows").is_none_or(|r| {
                        r.as_array()
                            .is_some_and(|r| r.iter().all(|x| row_ok(x, DAILY_SOURCE_ROW)))
                    })
            })
        });
        if !pub_ok || !daily_ok || !rows.iter().all(|r| row_ok(r, kind.row_fields())) {
            return Err(invalid);
        }
    } else {
        let row = o.get(data).ok_or(invalid.clone())?;
        if row.get("_id").is_some()
            || !row_ok(row, kind.row_fields())
            || o.get("fcsDate").and_then(ext_date_ms).is_none()
            || o.get("pubDate").and_then(ext_date_ms).is_none()
        {
            return Err(invalid);
        }
    }
    Ok(())
}

/// Extended JSON numbers (relaxed or canonical) to f64.
fn ext_number(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::Object(o) if o.len() == 1 => {
            let (k, inner) = o.iter().next()?;
            let s = inner.as_str()?;
            match k.as_str() {
                "$numberInt" | "$numberLong" => s.parse::<i64>().ok().map(|n| n as f64),
                "$numberDouble" | "$numberDecimal" => match s {
                    "Infinity" => Some(f64::INFINITY),
                    "-Infinity" => Some(f64::NEG_INFINITY),
                    "NaN" => Some(f64::NAN),
                    _ => s.parse::<f64>().ok(),
                },
                _ => None,
            }
        }
        _ => None,
    }
}
/// Extended JSON dates: `{"$date":ISO}`, `{"$date":{"$numberLong":ms}}` or `{"$date":ms}`.
fn ext_date_ms(v: &Value) -> Option<i64> {
    let inner = v.as_object().filter(|o| o.len() == 1)?.get("$date")?;
    match inner {
        Value::String(s) => parse_iso(s),
        Value::Number(n) => n.as_i64(),
        Value::Object(o) if o.len() == 1 => o.get("$numberLong")?.as_str()?.parse().ok(),
        _ => None,
    }
}
/// `YYYY-MM-DDTHH:MM:SS(.f{1,9})?(Z|±HH:MM)` to UTC milliseconds.
pub fn parse_iso(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
    {
        return None;
    }
    let num = |r: std::ops::Range<usize>| -> Option<i64> {
        let t = s.get(r)?;
        t.bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| t.parse().ok())?
    };
    let (y, mo, d, h, mi, sec) = (
        num(0..4)?,
        num(5..7)?,
        num(8..10)?,
        num(11..13)?,
        num(14..16)?,
        num(17..19)?,
    );
    let mut i = 19;
    let mut millis = 0i64;
    if b.get(i) == Some(&b'.') {
        let start = i + 1;
        i = start;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        let frac = s.get(start..i)?;
        if frac.is_empty() || frac.len() > 9 {
            return None;
        }
        millis = format!("{frac:0<3}")[..3].parse().ok()?;
    }
    let offset_min = match s.get(i..)? {
        "Z" => 0,
        o if o.len() == 6 && (o.starts_with('+') || o.starts_with('-')) && &o[3..4] == ":" => {
            let v = num(i + 1..i + 3)? * 60 + num(i + 4..i + 6)?;
            if o.starts_with('-') { -v } else { v }
        }
        _ => return None,
    };
    let month = time::Month::try_from(u8::try_from(mo).ok()?).ok()?;
    let date = time::Date::from_calendar_date(i32::try_from(y).ok()?, month, u8::try_from(d).ok()?)
        .ok()?;
    let clock = time::Time::from_hms(
        u8::try_from(h).ok()?,
        u8::try_from(mi).ok()?,
        u8::try_from(sec).ok()?,
    )
    .ok()?;
    let utc = time::PrimitiveDateTime::new(date, clock).assume_utc();
    Some(utc.unix_timestamp() * 1000 + millis - offset_min * 60_000)
}
/// Canonical `YYYY-MM-DDTHH:MM:SS.mmmZ` (the converter's form).
pub fn format_iso(ms: i64) -> String {
    let t = time::OffsetDateTime::from_unix_timestamp(ms.div_euclid(1000))
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        t.year(),
        u8::from(t.month()),
        t.day(),
        t.hour(),
        t.minute(),
        t.second(),
        ms.rem_euclid(1000)
    )
}
fn kst_publication(ms: i64) -> Publication {
    schedule::from_ms(ms)
}
/// Catalog partition of an export instant: KST `YYYYMMDD-HHMM`.
pub fn partition(exported_at_ms: u64) -> String {
    kst_publication(exported_at_ms as i64).partition()
}
pub fn catalog_id(
    kind: LegacyKind,
    key: ExportKey,
    exported_at_ms: u64,
) -> Result<CatalogId, LegacyError> {
    let id = CatalogId {
        source: SOURCE.into(),
        kind: kind.kind().into(),
        key_sha256: sha256(&key.provider_key().canonical_bytes()?),
        partition: partition(exported_at_ms),
    };
    id.validate()?;
    Ok(id)
}

/// One single-member acquisition per seed group, ready for S06 publication.
pub fn acquisitions(
    seed: &SeedFile,
    limits: &CatalogLimits,
) -> Result<Vec<Acquisition>, LegacyError> {
    let exported = seed.manifest.exported_at_ms;
    let publication = kst_publication(exported as i64);
    let mut out = Vec::with_capacity(seed.groups.len());
    for g in &seed.groups {
        let mut body = Vec::with_capacity(seed.manifest_line.len() + g.line.len() + 2);
        body.extend_from_slice(&seed.manifest_line);
        body.push(b'\n');
        body.extend_from_slice(&g.line);
        body.push(b'\n');
        let record = RawRecord::new(
            SOURCE,
            seed.kind.kind(),
            &g.key.provider_key(),
            publication.period(),
            exported,
            200,
            "application/json",
            None,
            body.into(),
            &limits.raw,
        )?;
        let declaration = GroupDeclaration::new(
            vec![GroupMember {
                envelope: record.envelope.clone(),
                catalogs: vec![CatalogId::for_record(
                    &record.envelope.identity,
                    &publication.partition(),
                )?],
            }],
            limits,
        )?;
        out.push(Acquisition {
            declaration,
            records: vec![record],
        });
    }
    Ok(out)
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ImportReport {
    pub groups: usize,
    pub documents: usize,
}
/// Publish every seed group through S06. Identical repeated imports are idempotent.
pub async fn import<P: Publisher>(
    publisher: &P,
    seed: &SeedFile,
    deadline: Instant,
) -> Result<ImportReport, LegacyError> {
    let mut report = ImportReport::default();
    for (acquisition, group) in acquisitions(seed, &CatalogLimits::default())?
        .into_iter()
        .zip(&seed.groups)
    {
        publisher.publish(acquisition, deadline).await?;
        report.groups += 1;
        report.documents += group.documents;
    }
    Ok(report)
}
/// Parse a stored export record body (manifest line + group line) back into its documents.
pub fn record_documents(body: &[u8]) -> Result<ExportRecord, LegacyError> {
    let seed = parse_lines(body)?;
    if seed.groups.len() != 1 {
        return Err(LegacyError::Invalid("export record"));
    }
    let ParsedGroup { key, lines, docs } = group(seed.kind, &seed.groups[0].line)?;
    Ok(ExportRecord {
        manifest: seed.manifest,
        kind: seed.kind,
        key,
        lines,
        documents: docs.into_iter().map(<[u8]>::to_vec).collect(),
    })
}

/// JavaScript `JSON.stringify` number text for finite values (`null` otherwise).
fn js_number(n: f64) -> String {
    if !n.is_finite() {
        return "null".into();
    }
    if n == 0.0 {
        return "0".into();
    }
    if n.fract() == 0.0 && n.abs() < 1e21 {
        return format!("{n:.0}");
    }
    if n.abs() < 1e-6 || n.abs() >= 1e21 {
        let s = format!("{n:e}");
        return match s.split_once('e') {
            Some((m, e)) if !e.starts_with('-') => format!("{m}e+{e}"),
            _ => s,
        };
    }
    format!("{n}")
}
/// A stored field as `JSON.stringify` emits the lean Mongo value.
fn js_value(v: &Value) -> Result<String, LegacyError> {
    Ok(match v {
        Value::Number(n) => js_number(n.as_f64().ok_or(LegacyError::Invalid("number"))?),
        Value::Object(_) => match (ext_number(v), ext_date_ms(v)) {
            (Some(n), _) => js_number(n),
            (None, Some(ms)) => serde_json::to_string(&format_iso(ms)).expect("string"),
            _ => return Err(LegacyError::Invalid("field value")),
        },
        other => serde_json::to_string(other).expect("scalar"),
    })
}
fn project(row: &serde_json::Map<String, Value>) -> Result<String, LegacyError> {
    let mut out = String::from("{");
    for field in CURRENT_PROJECTION {
        if let Some(v) = row.get(*field) {
            if out.len() > 1 {
                out.push(',');
            }
            out.push_str(&format!("\"{field}\":{}", js_value(v)?));
        }
    }
    out.push('}');
    Ok(out)
}
/// Legacy read projection of current rows, as `JSON.stringify` of the callback value:
/// v2 `kmaTownCurrent.getCurrentFromDB` (rows sorted by `fcsDate`, `pubDate` of the last row in
/// KST) or v1 `ControllerTown._getTownDataFromDB` (first document, stored `pubDate`).
pub fn current_rows(kind: LegacyKind, documents: &[Vec<u8>]) -> Result<Vec<u8>, LegacyError> {
    let invalid = LegacyError::Invalid("current rows");
    let docs: Vec<Value> = documents
        .iter()
        .map(|d| serde_json::from_slice(d).map_err(|_| invalid.clone()))
        .collect::<Result<_, _>>()?;
    match kind {
        LegacyKind::TownCurrent => {
            let mut sorted: Vec<(i64, &Value)> = docs
                .iter()
                .map(|d| {
                    Ok((
                        d.get("fcsDate")
                            .and_then(ext_date_ms)
                            .ok_or(invalid.clone())?,
                        d,
                    ))
                })
                .collect::<Result<_, LegacyError>>()?;
            sorted.sort_by_key(|(t, _)| *t);
            let last = sorted.last().ok_or(invalid.clone())?.1;
            let pub_ms = last
                .get("pubDate")
                .and_then(ext_date_ms)
                .ok_or(invalid.clone())?;
            let rows = sorted
                .iter()
                .map(|(_, d)| {
                    project(
                        d.get("currentData")
                            .and_then(Value::as_object)
                            .ok_or(invalid.clone())?,
                    )
                })
                .collect::<Result<Vec<_>, _>>()?;
            let pub_date = kst_publication(pub_ms).compact();
            Ok(format!(
                "{{\"pubDate\":\"{pub_date}\",\"ret\":[{}]}}",
                rows.join(",")
            )
            .into_bytes())
        }
        LegacyKind::CurrentV1 => {
            let first = docs.first().ok_or(invalid.clone())?;
            let rows = first
                .get("currentData")
                .and_then(Value::as_array)
                .ok_or(invalid.clone())?
                .iter()
                .map(|r| project(r.as_object().ok_or(invalid.clone())?))
                .collect::<Result<Vec<_>, _>>()?;
            let mut out = String::from("{");
            if let Some(p) = first.get("pubDate") {
                out.push_str(&format!("\"pubDate\":{},", js_value(p)?));
            }
            out.push_str(&format!("\"ret\":[{}],\"dailyRows\":[]}}", rows.join(",")));
            Ok(out.into_bytes())
        }
        _ => Err(invalid),
    }
}
/// Exported `KmaStnMinute2` documents of `station` with `date > after_ms`, sorted by `date`
/// (legacy `_getStnMinute2`; `date` holds the KST wall clock in UTC fields).
pub fn minute_rows(
    documents: &[Vec<u8>],
    station: u32,
    after_ms: i64,
) -> Result<Vec<Vec<u8>>, LegacyError> {
    let mut out = Vec::new();
    for d in documents {
        let v: Value = serde_json::from_slice(d).map_err(|_| LegacyError::Invalid("minute row"))?;
        let id = v.get("stnId").and_then(ext_number);
        let date = v
            .get("date")
            .and_then(ext_date_ms)
            .ok_or(LegacyError::Invalid("minute date"))?;
        if id == Some(f64::from(station)) && date > after_ms {
            out.push((date, d.clone()));
        }
    }
    out.sort_by_key(|(t, _)| *t);
    Ok(out.into_iter().map(|(_, d)| d).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn javascript_number_text() {
        for (n, s) in [
            (20.0, "20"),
            (-0.8, "-0.8"),
            (18.25, "18.25"),
            (-50.0, "-50"),
            (0.0, "0"),
            (-0.0, "0"),
            (1e21, "1e+21"),
            (1.5e-7, "1.5e-7"),
            (f64::NAN, "null"),
        ] {
            assert_eq!(js_number(n), s, "{n}");
        }
    }
    #[test]
    fn iso_round_trip_and_offsets() {
        assert_eq!(
            parse_iso("2026-09-24T02:10:00.000Z"),
            Some(1_790_215_800_000)
        );
        assert_eq!(parse_iso("2026-09-24T02:10:00Z"), Some(1_790_215_800_000));
        assert_eq!(
            parse_iso("2026-09-24T11:10:00+09:00"),
            Some(1_790_215_800_000)
        );
        assert_eq!(parse_iso("2026-09-24T02:10:00.5Z"), Some(1_790_215_800_500));
        assert_eq!(format_iso(1_790_215_800_500), "2026-09-24T02:10:00.500Z");
        assert_eq!(parse_iso("2026-09-24 02:10:00Z"), None);
        assert_eq!(parse_iso("2026-02-30T00:00:00Z"), None);
    }
    #[test]
    fn compact_scanner_splits_exact_values() {
        let line = br#"{"key":{"type":"grid","nx":1,"ny":2},"lines":[1,2],"documents":[{"a":"x,]}"},{"b":[1,{"c":2}]}]}"#;
        let m = members(line).unwrap();
        assert_eq!(
            m.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(),
            ["key", "lines", "documents"]
        );
        let docs = &line[m[2].1.clone()];
        let e = elements(docs).unwrap();
        assert_eq!(&docs[e[0].clone()], br#"{"a":"x,]}"}"#);
        assert_eq!(&docs[e[1].clone()], br#"{"b":[1,{"c":2}]}"#);
        assert!(members(br#"{"a":1} "#).is_none());
        assert!(elements(b"[1,]").is_none());
    }
}
