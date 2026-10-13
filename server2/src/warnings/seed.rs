//! Legacy seed import: canonical files written by `tools/migration/export_warning_seeds.py`.
//! Each exported `KmaSpecialWeatherSituation` document becomes one immutable raw record in
//! its type/announcement-date catalog; the zone export becomes one `zone-seed` record.
use super::{
    js,
    records::{self, LEGACY_SPECIAL_ROLE, LEGACY_ZONE_ROLE, Member, SEED_DATE, ZONE_SEED_KIND},
    store::WarningStore,
};
use crate::{
    gateway::OrderedJson,
    storage::{CatalogTransport, Error},
};
use std::sync::Arc;
use tokio::time::Instant;

pub const SCHEMA: f64 = 1.;

/// Parsed seed file: export time and per-document exact bytes.
#[derive(Clone, Debug)]
pub struct SeedFile {
    pub exported_at_ms: u64,
    pub special: Vec<(u8, u32, Arc<[u8]>)>,
    pub zones: Option<Arc<[u8]>>,
}
/// Validates `{"schema":1,"exportedAt":ISO,"special":[doc...],"zones":[doc...]}`.
pub fn parse(bytes: &[u8]) -> Result<SeedFile, Error> {
    let file = OrderedJson::parse(bytes).map_err(|_| Error::Invalid("seed JSON"))?;
    if file.get("schema").and_then(OrderedJson::number) != Some(SCHEMA) {
        return Err(Error::Invalid("seed schema"));
    }
    let exported_at_ms = file
        .get("exportedAt")
        .and_then(OrderedJson::string)
        .and_then(|s| js::parse_iso(&s))
        .and_then(|ms| u64::try_from(ms).ok())
        .ok_or(Error::Invalid("seed exportedAt"))?;
    let mut special = Vec::new();
    match file.get("special") {
        Some(OrderedJson::Array(docs)) => {
            for doc in docs {
                let bytes: Arc<[u8]> = doc.to_bytes().into();
                let kind = doc
                    .get("type")
                    .and_then(OrderedJson::number)
                    .filter(|k| [1., 2., 3., 4.].contains(k))
                    .ok_or(Error::Invalid("seed type"))? as u8;
                let bulletin = records::legacy_doc(kind, &bytes)
                    .map_err(|_| Error::Invalid("seed document"))?;
                special.push((kind, bulletin.date(), bytes));
            }
        }
        None => {}
        Some(_) => return Err(Error::Invalid("seed special")),
    }
    let zones = match file.get("zones") {
        Some(z @ OrderedJson::Array(_)) => Some(z.to_bytes().into()),
        None => None,
        Some(_) => return Err(Error::Invalid("seed zones")),
    };
    Ok(SeedFile {
        exported_at_ms,
        special,
        zones,
    })
}
/// Publishes every seed acquisition; already published identical seeds are idempotent.
pub async fn import<T: CatalogTransport>(
    store: &WarningStore<T>,
    seed: &SeedFile,
    deadline: Instant,
) -> Result<usize, Error> {
    let mut count = 0;
    for (kind, date, bytes) in &seed.special {
        store
            .publish(
                records::bulletin_kind(*kind),
                *date,
                vec![Member {
                    role: LEGACY_SPECIAL_ROLE.into(),
                    bytes: bytes.clone(),
                    fetched_at_ms: seed.exported_at_ms,
                }],
                deadline,
            )
            .await?;
        count += 1;
    }
    if let Some(bytes) = &seed.zones {
        store
            .publish(
                ZONE_SEED_KIND,
                SEED_DATE,
                vec![Member {
                    role: LEGACY_ZONE_ROLE.into(),
                    bytes: bytes.clone(),
                    fetched_at_ms: seed.exported_at_ms,
                }],
                deadline,
            )
            .await?;
        count += 1;
    }
    Ok(count)
}
