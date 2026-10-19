//! Fixed schema1 authority. Runtime never initializes or migrates this object.
use super::{Doc, Val, seed::StationSeed};
use crate::storage::{CatalogTransport, ControlObject, Error, WriteCondition, sha256};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use tokio::time::{Instant, timeout_at};

pub const KEY: &str = "index/v2/statistics/rns/state.json";
pub const POLICY: &str = "flat-minute-rnshit-v1";
pub const MAX_BODY: usize = 1024 * 1024;
pub const MAX_ROWS: usize = 1024;
pub const SAFE: u64 = 9_007_199_254_740_991;
const HOUR: u64 = 3_600_000;
pub const KST: u64 = 9 * HOUR;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ObjectId([u8; 12]);
impl ObjectId {
    pub fn parse(s: &str) -> Option<Self> {
        if s.len() != 24 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let mut bytes = [0; 12];
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
        }
        Some(Self(bytes))
    }
    pub fn text(self) -> String {
        self.0.iter().map(|b| format!("{b:02x}")).collect()
    }
}
impl Serialize for ObjectId {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.text())
    }
}
impl<'de> Deserialize<'de> for ObjectId {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        let oid = Self::parse(&s).ok_or_else(|| serde::de::Error::custom("ObjectId"))?;
        if oid.text() != s {
            return Err(serde::de::Error::custom("canonical ObjectId"));
        }
        Ok(oid)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Namespace {
    pub bucket: String,
    pub region: String,
}
impl Namespace {
    /// Construct from the already validated production S3Settings, or an explicit owned fixture.
    pub fn new(bucket: String, region: String) -> Result<Self, Error> {
        if !(3..=63).contains(&bucket.len())
            || !bucket
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.')
            || !bucket.as_bytes()[0].is_ascii_alphanumeric()
            || !bucket.as_bytes()[bucket.len() - 1].is_ascii_alphanumeric()
            || bucket.contains("..")
            || region.is_empty()
            || region.len() > 32
            || !region
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err(Error::Invalid("rainfall target"));
        }
        Ok(Self { bucket, region })
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub store: String,
    pub database: String,
    pub collection: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Activation {
    pub epoch: String,
    pub policy: String,
    pub target: Namespace,
    pub source: Source,
    pub seed_body_sha256: String,
    pub seed_source_sha256: String,
    pub seed_exported_at_ms: u64,
    pub seed_documents: usize,
    pub seed_identity_sha256: String,
    pub baseline_sha256: String,
    pub shutdown_at_ms: u64,
    pub shutdown_evidence_sha256: String,
    pub first_end_ms: u64,
    pub first_end_basis: String,
    #[serde(deserialize_with = "required_option")]
    pub legacy_highwater_ms: Option<u64>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    pub end_ms: u64,
    pub cutoff_at_ms: u64,
    pub grid: [u16; 2],
    pub current_sha256: String,
    pub minute_sha256: String,
    pub batch_sha256: String,
    pub row_count: usize,
    pub sensor_count: usize,
    pub hit: bool,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Row {
    pub oid: ObjectId,
    #[serde(deserialize_with = "required_option")]
    pub rns_hit: Option<f64>,
    #[serde(deserialize_with = "required_option")]
    pub rns_count: Option<f64>,
    #[serde(deserialize_with = "required_option")]
    pub last_end_ms: Option<u64>,
    #[serde(deserialize_with = "required_option")]
    pub receipt: Option<Receipt>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Checkpoint {
    pub schema: u8,
    pub revision: u64,
    pub activation: Activation,
    pub rows: Vec<Row>,
}
pub fn digest(v: Value) -> String {
    sha256(&serde_json::to_vec(&v).expect("bounded JSON digest"))
}
fn hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn required_option<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
fn positive(n: u64) -> bool {
    n > 0 && n <= SAFE
}
fn canonical_end(ms: u64) -> bool {
    positive(ms)
        && ms.is_multiple_of(HOUR)
        && time::OffsetDateTime::from_unix_timestamp((ms / 1000) as i64)
            .is_ok_and(|t| (1970..=9999).contains(&t.year()))
}
pub fn counter(n: Option<f64>) -> bool {
    n.is_none_or(|n| n.is_finite() && n.abs() <= SAFE as f64)
}
pub fn baseline(seed: &StationSeed) -> Result<Vec<Row>, Error> {
    if seed.docs.is_empty()
        || seed.docs.len() > MAX_ROWS
        || seed.identities.len() != seed.docs.len()
    {
        return Err(Error::Invalid("rainfall seed size"));
    }
    let mut rows = Vec::with_capacity(seed.docs.len());
    let mut ids = BTreeSet::new();
    for (d, id) in seed.docs.iter().zip(&seed.identities) {
        let oid = id.ok_or(Error::Invalid("rainfall original identity"))?;
        if !ids.insert(oid) {
            return Err(Error::Invalid("rainfall duplicate identity"));
        }
        let num = |k| match d.get(k) {
            Some(Val::Num(n)) => Some(*n),
            _ => None,
        };
        let row = Row {
            oid,
            rns_hit: num("rnsHit"),
            rns_count: num("rnsCount"),
            last_end_ms: None,
            receipt: None,
        };
        if !counter(row.rns_hit) || !counter(row.rns_count) {
            return Err(Error::Invalid("rainfall seed counters"));
        }
        rows.push(row);
    }
    rows.sort_by_key(|r| r.oid);
    Ok(rows)
}
pub fn identity_digest(rows: &[Row]) -> String {
    digest(json!([
        "rns-identities-v1",
        rows.iter().map(|r| r.oid).collect::<Vec<_>>()
    ]))
}
pub fn baseline_digest(seed: &StationSeed, rows: &[Row]) -> String {
    digest(json!([
        "rns-baseline-v1",
        seed.body_sha256,
        rows.iter()
            .map(|r| json!([r.oid, r.rns_hit, r.rns_count]))
            .collect::<Vec<_>>()
    ]))
}
impl Checkpoint {
    pub fn initial(
        activation: Activation,
        seed: &StationSeed,
        target: &Namespace,
    ) -> Result<Self, Error> {
        let state = Self {
            schema: 1,
            revision: 1,
            activation,
            rows: baseline(seed)?,
        };
        state.validate(seed, target)?;
        state.encode()?;
        Ok(state)
    }
    pub fn decode(bytes: &[u8], seed: &StationSeed, target: &Namespace) -> Result<Self, Error> {
        let state = Self::decode_intrinsic(bytes, target)?;
        state.validate(seed, target)?;
        Ok(state)
    }
    pub fn encode(&self) -> Result<Vec<u8>, Error> {
        let b = serde_json::to_vec(self).map_err(|_| Error::Invalid("rainfall encoding"))?;
        if b.len() > MAX_BODY {
            return Err(Error::Capacity);
        }
        Ok(b)
    }
    /// Strict intrinsic validation precedes any seed dependency selection. No untyped JSON peek
    /// can select an S3 namespace or authorize an overlay/write.
    pub fn decode_intrinsic(bytes: &[u8], target: &Namespace) -> Result<Self, Error> {
        if bytes.len() > MAX_BODY {
            return Err(Error::Capacity);
        }
        let state: Self =
            serde_json::from_slice(bytes).map_err(|_| Error::Corrupt("rainfall schema"))?;
        state.validate_intrinsic(target)?;
        Ok(state)
    }
    pub fn validate_intrinsic(&self, target: &Namespace) -> Result<(), Error> {
        let a = &self.activation;
        if self.schema != 1
            || !positive(self.revision)
            || !(1..=MAX_ROWS).contains(&a.seed_documents)
            || self.rows.len() != a.seed_documents
            || a.policy != POLICY
            || &a.target != target
            || Namespace::new(a.target.bucket.clone(), a.target.region.clone()).is_err()
            || a.source.store != "mongo"
            || a.source.collection != "kmastninfos"
            || a.source.database.is_empty()
            || a.source.database.len() > 64
            || !a
                .source
                .database
                .bytes()
                .all(|b| b.is_ascii() && !b.is_ascii_control())
            || [
                &a.epoch,
                &a.shutdown_evidence_sha256,
                &a.seed_body_sha256,
                &a.seed_source_sha256,
                &a.seed_identity_sha256,
                &a.baseline_sha256,
            ]
            .iter()
            .any(|s| !hash(s))
            || !positive(a.shutdown_at_ms)
            || !positive(a.seed_exported_at_ms)
            || !canonical_end(a.first_end_ms)
            || a.seed_exported_at_ms < a.shutdown_at_ms
            || !a.first_end_ms.is_multiple_of(HOUR)
            || a.first_end_ms < KST + HOUR
        {
            return Err(Error::Corrupt("rainfall activation shape/target"));
        }
        export_day(a.seed_exported_at_ms)?;
        match (a.first_end_basis.as_str(), a.legacy_highwater_ms) {
            ("full-post-shutdown-hour", None)
                if a.first_end_ms - KST - HOUR >= a.shutdown_at_ms => {}
            ("legacy-highwater", Some(n)) if canonical_end(n) && a.first_end_ms > n => (),
            _ => return Err(Error::Corrupt("rainfall first end")),
        }
        let mut previous = None;
        for r in &self.rows {
            if previous.is_some_and(|p| p >= r.oid) || !counter(r.rns_hit) || !counter(r.rns_count)
            {
                return Err(Error::Corrupt("rainfall row identity/counter"));
            }
            previous = Some(r.oid);
            match (r.last_end_ms, &r.receipt) {
                (None, None) => (),
                (Some(end), Some(receipt))
                    if self.revision > 1
                        && canonical_end(end)
                        && end >= a.first_end_ms
                        && receipt.end_ms == end
                        && positive(receipt.cutoff_at_ms)
                        && receipt.cutoff_at_ms >= a.shutdown_at_ms
                        && (1..=149).contains(&receipt.grid[0])
                        && (1..=253).contains(&receipt.grid[1])
                        && (15..=60).contains(&receipt.row_count)
                        && (1..=receipt.row_count).contains(&receipt.sensor_count)
                        && hash(&receipt.current_sha256)
                        && hash(&receipt.minute_sha256)
                        && hash(&receipt.batch_sha256)
                        && r.rns_hit.is_some()
                        && r.rns_count.is_some() => {}
                _ => return Err(Error::Corrupt("rainfall row receipt")),
            }
        }
        Ok(())
    }
    pub fn validate(&self, seed: &StationSeed, target: &Namespace) -> Result<(), Error> {
        self.validate_intrinsic(target)?;
        let a = &self.activation;
        let base = baseline(seed)?;
        if a.seed_body_sha256 != seed.body_sha256
            || a.seed_source_sha256 != seed.source_sha256
            || a.seed_exported_at_ms != seed.exported_at_ms
            || a.seed_documents != seed.docs.len()
            || a.seed_identity_sha256 != identity_digest(&base)
            || a.baseline_sha256 != baseline_digest(seed, &base)
            || self.rows.len() != base.len()
        {
            return Err(Error::Corrupt("rainfall activation binding"));
        }
        for (r, b) in self.rows.iter().zip(&base) {
            if r.oid != b.oid
                || r.last_end_ms.is_none() && (r.rns_hit != b.rns_hit || r.rns_count != b.rns_count)
                || self.revision == 1 && r != b
            {
                return Err(Error::Corrupt("rainfall baseline binding"));
            }
        }
        Ok(())
    }
    pub fn overlay(&self, doc: &mut Doc, oid: ObjectId) {
        if let Some(r) = self.rows.iter().find(|r| r.oid == oid) {
            for (k, v) in [("rnsHit", r.rns_hit), ("rnsCount", r.rns_count)] {
                match v {
                    Some(n) => doc.set(k, Val::Num(n)),
                    None => doc.remove(k),
                }
            }
        }
    }
}
fn export_day(ms: u64) -> Result<u32, Error> {
    let utc = time::OffsetDateTime::from_unix_timestamp(
        i64::try_from(ms / 1000).map_err(|_| Error::Corrupt("rainfall export instant"))?,
    )
    .map_err(|_| Error::Corrupt("rainfall export instant"))?;
    let kst = utc
        .checked_add(time::Duration::hours(9))
        .ok_or(Error::Corrupt("rainfall export instant"))?;
    if !(1970..=9999).contains(&kst.year()) {
        return Err(Error::Corrupt("rainfall export day"));
    }
    Ok(kst.year() as u32 * 10000 + u32::from(u8::from(kst.month())) * 100 + u32::from(kst.day()))
}
#[derive(Clone)]
pub struct Store<T> {
    pub transport: T,
    pub target: Namespace,
}
impl<T: CatalogTransport> Store<T> {
    pub async fn read_intrinsic(
        &self,
        deadline: Instant,
    ) -> Result<Option<(Checkpoint, ControlObject)>, Error> {
        match timeout_at(deadline, self.transport.get_control(KEY, MAX_BODY))
            .await
            .map_err(|_| Error::Timeout)?
        {
            Ok(object) => Ok(Some((
                Checkpoint::decode_intrinsic(&object.body, &self.target)?,
                object,
            ))),
            Err(Error::NotFound) => Ok(None),
            Err(e) => Err(e),
        }
    }
    /// Resolve only the exact complete seed acquisition bound by a strict, externally targeted
    /// authority. The seed manifest proves collection/export/source bytes, not the operational
    /// Mongo database name (that name and shutdown truth remain operator evidence).
    pub async fn resolve(
        &self,
        candidate: std::sync::Arc<StationSeed>,
        catalog: &crate::storage::CatalogStore<T>,
        deadline: Instant,
    ) -> Result<Option<(Checkpoint, ControlObject, std::sync::Arc<StationSeed>)>, Error> {
        let Some((state, object)) = self.read_intrinsic(deadline).await? else {
            return Ok(None);
        };
        let seed = if candidate.body_sha256 == state.activation.seed_body_sha256 {
            candidate
        } else {
            let a = &state.activation;
            let day = export_day(a.seed_exported_at_ms)?;
            let key = super::seed::key();
            let id = crate::storage::RecordId {
                source: super::seed::SOURCE.into(),
                kind: super::seed::KIND.into(),
                key_sha256: sha256(&key.canonical_bytes()?),
                period: crate::storage::Period {
                    local_date: day,
                    slot: "0000".into(),
                },
                fetched_at_ms: a.seed_exported_at_ms,
                raw_sha256: a.seed_body_sha256.clone(),
            };
            let control = crate::storage::CatalogId::for_record(&id, &day.to_string())?;
            let crate::storage::PageOutcome::Ready(page) =
                catalog.lookup_acquisition(&control, &id, deadline).await?
            else {
                return Err(Error::Corrupt("rainfall exact seed incomplete"));
            };
            if page.excluded_groups() != 0
                || page.acquisitions().len() != 1
                || page.acquisitions()[0].records().len() != 1
            {
                return Err(Error::Corrupt("rainfall exact seed scope"));
            }
            let raw = &page.acquisitions()[0].records()[0];
            if raw.envelope.identity != id {
                return Err(Error::Corrupt("rainfall exact seed identity"));
            }
            std::sync::Arc::new(
                super::seed::parse(&raw.bytes)
                    .map_err(|_| Error::Corrupt("rainfall exact seed body"))?,
            )
        };
        state.validate(&seed, &self.target)?;
        Ok(Some((state, object, seed)))
    }
    pub async fn read(
        &self,
        seed: &StationSeed,
        deadline: Instant,
    ) -> Result<Option<(Checkpoint, ControlObject)>, Error> {
        match timeout_at(deadline, self.transport.get_control(KEY, MAX_BODY))
            .await
            .map_err(|_| Error::Timeout)?
        {
            Ok(object) => Ok(Some((
                Checkpoint::decode(&object.body, seed, &self.target)?,
                object,
            ))),
            Err(Error::NotFound) => Ok(None),
            Err(e) => Err(e),
        }
    }
    pub async fn put(&self, bytes: &[u8], etag: &str, deadline: Instant) -> Result<u16, Error> {
        if bytes.len() > MAX_BODY {
            return Err(Error::Capacity);
        }
        timeout_at(
            deadline,
            self.transport
                .put_control(KEY, bytes, &WriteCondition::Match(etag.into())),
        )
        .await
        .map_err(|_| Error::Timeout)?
    }
    /// Operator only: exact encoded bytes, conditional creation, mandatory exact readback.
    pub async fn activate(
        &self,
        state: &Checkpoint,
        seed: &StationSeed,
        deadline: Instant,
    ) -> Result<(), Error> {
        state.validate(seed, &self.target)?;
        if state.revision != 1 {
            return Err(Error::Invalid("rainfall activation revision"));
        }
        let bytes = state.encode()?;
        let status = timeout_at(
            deadline,
            self.transport
                .put_control(KEY, &bytes, &WriteCondition::Absent),
        )
        .await
        .map_err(|_| Error::Timeout)??;
        if status != 200 {
            return Err(Error::Status(status));
        }
        let (_, read) = self.read(seed, deadline).await?.ok_or(Error::Ambiguous)?;
        if read.body != bytes {
            return Err(Error::Ambiguous);
        }
        Ok(())
    }
}
