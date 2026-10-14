//! The station registry seed (AK, 2026-10-15): a one-time copy of legacy `kmastninfos`
//! converted by `tools/migration/export_station_seeds.py` and published by the
//! `station_seed_import` tool as one raw record (source `legacy-mongo`, kind `kma-stn-info`).
//! The registry starts from the seed's documents (legacy fields such as `rnsHit`, `rnsCount` and
//! `isMountain` included) and the station pages then apply the legacy saver rules on top.
use super::doc::{Doc, Val};
use crate::resolver::Acquisition;
use crate::storage::{
    CatalogId, CatalogLimits, GroupDeclaration, GroupMember, Period, ProviderKey, RawRecord,
};
use crate::gateway::OrderedJson;
use serde_json::Value;

pub const SOURCE: &str = "legacy-mongo";
pub const KIND: &str = "kma-stn-info";
pub fn key() -> ProviderKey {
    ProviderKey::Named {
        id: "kmastninfos".into(),
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeedError(pub &'static str);
impl std::fmt::Display for SeedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "station seed: {}", self.0)
    }
}
impl std::error::Error for SeedError {}

/// A parsed seed: the export instant and the registry documents in export order (`_id`
/// dropped; the readers project it away).
#[derive(Debug, Clone)]
pub struct StationSeed {
    pub exported_at_ms: u64,
    pub source_sha256: String,
    pub docs: Vec<Doc>,
}
const FIELDS: [&str; 11] = [
    "_id",
    "stnId",
    "stnName",
    "addr",
    "isCityWeather",
    "altitude",
    "geo",
    "rnsHit",
    "rnsCount",
    "isMountain",
    "__v",
];
fn number(v: &OrderedJson) -> Result<f64, SeedError> {
    let bad = SeedError("number");
    let n = match v {
        OrderedJson::Number(n) => *n,
        OrderedJson::Object(o) if o.len() == 1 => {
            let (wrapper, text) = &o[0];
            let text = text.string().ok_or(bad.clone())?;
            match String::from_utf16_lossy(wrapper).as_str() {
                "$numberInt" | "$numberLong" => {
                    text.parse::<i64>().map_err(|_| bad.clone())? as f64
                }
                "$numberDouble" | "$numberDecimal" => {
                    text.parse::<f64>().map_err(|_| bad.clone())?
                }
                _ => return Err(bad),
            }
        }
        _ => return Err(bad),
    };
    n.is_finite().then_some(n).ok_or(bad)
}
fn iso_ms(s: &str) -> Option<u64> {
    u64::try_from(crate::history::legacy::parse_iso(s)?).ok()
}
/// Parse and validate a seed file (manifest line, then the export lines).
pub fn parse(bytes: &[u8]) -> Result<StationSeed, SeedError> {
    if bytes.is_empty() || bytes.contains(&b'\r') || !bytes.ends_with(b"\n") {
        return Err(SeedError("framing"));
    }
    let mut lines = bytes[..bytes.len() - 1].split(|b| *b == b'\n');
    let manifest: Value =
        serde_json::from_slice(lines.next().ok_or(SeedError("manifest"))?)
            .map_err(|_| SeedError("manifest"))?;
    let field = |k: &str| manifest.get(k).ok_or(SeedError("manifest"));
    if field("schema")? != 1
        || field("tool")? != "export_station_seeds"
        || field("collection")? != "kmastninfos"
        || manifest.as_object().map(|o| o.len()) != Some(6)
    {
        return Err(SeedError("manifest"));
    }
    let exported_at_ms = field("exportedAt")?
        .as_str()
        .and_then(iso_ms)
        .ok_or(SeedError("exportedAt"))?;
    let source_sha256 = field("sourceSha256")?
        .as_str()
        .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or(SeedError("sourceSha256"))?
        .to_owned();
    let mut docs = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for line in lines {
        let doc = OrderedJson::parse(line).map_err(|_| SeedError("document"))?;
        let OrderedJson::Object(entries) = &doc else {
            return Err(SeedError("document"));
        };
        let mut out = Doc::new();
        let mut keys = std::collections::BTreeSet::new();
        for (k, v) in entries {
            let k = String::from_utf16_lossy(k);
            if !FIELDS.contains(&k.as_str()) || !keys.insert(k.clone()) {
                return Err(SeedError("unknown or repeated field"));
            }
            let val = match k.as_str() {
                "_id" => continue,
                "stnId" => {
                    let s = v.string().ok_or(SeedError("stnId"))?;
                    if s.is_empty() || s.len() > 8 || !s.bytes().all(|b| b.is_ascii_digit()) {
                        return Err(SeedError("stnId"));
                    }
                    if !seen.insert(s.clone()) {
                        return Err(SeedError("repeated stnId"));
                    }
                    Val::str(s)
                }
                "stnName" | "addr" => Val::str(v.string().ok_or(SeedError("text field"))?),
                "isCityWeather" | "isMountain" => match v {
                    OrderedJson::Bool(b) => Val::Bool(*b),
                    _ => return Err(SeedError("boolean field")),
                },
                "altitude" | "rnsHit" | "rnsCount" | "__v" => Val::num(number(v)?),
                "geo" => {
                    let OrderedJson::Array(a) = v else {
                        return Err(SeedError("geo"));
                    };
                    let g: Vec<f64> = a.iter().map(number).collect::<Result<_, _>>()?;
                    if !(g.is_empty() || g.len() == 2) {
                        return Err(SeedError("geo"));
                    }
                    Val::Arr(g.into_iter().map(Val::num).collect())
                }
                _ => return Err(SeedError("field")),
            };
            out.set(&k, val);
        }
        if !out.has("stnId") {
            return Err(SeedError("stnId"));
        }
        docs.push(out);
    }
    if docs.is_empty() || field("documents")?.as_u64() != Some(docs.len() as u64) {
        return Err(SeedError("document count"));
    }
    Ok(StationSeed {
        exported_at_ms,
        source_sha256,
        docs,
    })
}
/// The raw-record acquisition of a validated seed file (partition: the export's KST day).
pub fn acquisition(bytes: &[u8]) -> Result<Acquisition, SeedError> {
    let seed = parse(bytes)?;
    let day = crate::history::schedule::from_ms(seed.exported_at_ms as i64);
    let limits = CatalogLimits::default();
    let record = RawRecord::new(
        SOURCE,
        KIND,
        &key(),
        Period {
            local_date: day.date(),
            slot: "0000".into(),
        },
        seed.exported_at_ms,
        200,
        "application/x-ndjson",
        None,
        bytes.to_vec().into(),
        &limits.raw,
    )
    .map_err(|_| SeedError("raw record"))?;
    let member = GroupMember {
        envelope: record.envelope.clone(),
        catalogs: vec![
            CatalogId::for_record(&record.envelope.identity, &day.base_date())
                .map_err(|_| SeedError("catalog"))?,
        ],
    };
    Ok(Acquisition {
        declaration: GroupDeclaration::new(vec![member], &limits)
            .map_err(|_| SeedError("group"))?,
        records: vec![record],
    })
}
