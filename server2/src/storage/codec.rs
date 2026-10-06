use super::{Error, Limits, Object};
use base64::{Engine, engine::general_purpose::STANDARD};
use flate2::{Compression, GzBuilder, bufread::GzDecoder};
use md5::Md5;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{Cursor, Read, Write},
    sync::Arc,
};
use time::{Date, Month};
struct CappedBuffer {
    bytes: Vec<u8>,
    maximum: usize,
}
impl Write for CappedBuffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > self.maximum.saturating_sub(self.bytes.len()) {
            return Err(std::io::Error::other("compressed limit"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn token(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
/// Coordinates are upstream privacy-reduced provider identities, never user coordinates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ProviderKey {
    Grid {
        nx: u16,
        ny: u16,
    },
    WorldCell {
        lat_hundredths: i16,
        lon_hundredths: i16,
    },
    Station {
        id: String,
    },
    Named {
        id: String,
    },
}
impl ProviderKey {
    fn validate(&self) -> Result<(), Error> {
        let valid = match self {
            Self::Grid { nx, ny } => *nx > 0 && *nx <= 149 && *ny > 0 && *ny <= 253,
            Self::WorldCell {
                lat_hundredths,
                lon_hundredths,
            } => {
                (-8999..=8999).contains(lat_hundredths)
                    && (-17999..=17999).contains(lon_hundredths)
                    && lat_hundredths % 2 != 0
                    && lon_hundredths % 2 != 0
            }
            Self::Station { id } | Self::Named { id } => token(id, 96),
        };
        if valid {
            Ok(())
        } else {
            Err(Error::Invalid("provider key"))
        }
    }
    pub fn canonical_bytes(&self) -> Result<Vec<u8>, Error> {
        self.validate()?;
        serde_json::to_vec(self).map_err(|_| Error::Invalid("key serialization"))
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Period {
    pub local_date: u32,
    pub slot: String,
}
impl Period {
    fn validate(&self) -> Result<(), Error> {
        let date = self.local_date;
        let m = Month::try_from(((date / 100) % 100) as u8)
            .map_err(|_| Error::Invalid("placement date"))?;
        Date::from_calendar_date((date / 10000) as i32, m, (date % 100) as u8)
            .map_err(|_| Error::Invalid("placement date"))?;
        if !(19700101..=99991231).contains(&date) || !token(&self.slot, 40) {
            return Err(Error::Invalid("period"));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordId {
    pub source: String,
    pub kind: String,
    pub key_sha256: String,
    pub period: Period,
    pub fetched_at_ms: u64,
    pub raw_sha256: String,
}
impl RecordId {
    pub fn validate(&self) -> Result<(), Error> {
        self.period.validate()?;
        if !token(&self.source, 32)
            || !token(&self.kind, 48)
            || !hash(&self.key_sha256)
            || !hash(&self.raw_sha256)
            || self.fetched_at_ms > 253402300799999
        {
            return Err(Error::Invalid("record identity"));
        }
        Ok(())
    }
    pub fn object_key(&self) -> Result<String, Error> {
        self.validate()?;
        let d = self.period.local_date;
        Ok(format!(
            "raw/v2/{}/{}/{:04}/{:02}/{:02}/{}/{}/{}-{}.raw.gz",
            self.source,
            self.kind,
            d / 10000,
            (d / 100) % 100,
            d % 100,
            self.period.slot,
            self.key_sha256,
            self.fetched_at_ms,
            self.raw_sha256
        ))
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pagination {
    pub page: u32,
    pub pages: u32,
    pub complete: bool,
}
/// Identity-only recovery descriptor, fixed before the immutable body PUT.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FetchGroupRef {
    pub group_sha256: String,
    pub member_sha256: String,
    pub partitions_sha256: String,
    pub members: u32,
}
impl FetchGroupRef {
    pub fn descriptor_key(&self) -> Result<String, Error> {
        if !hash(&self.group_sha256)
            || !hash(&self.member_sha256)
            || !hash(&self.partitions_sha256)
            || self.members == 0
            || self.members > 10000
        {
            return Err(Error::Invalid("fetch group reference"));
        }
        Ok(format!("index/v2/groups/{}.json", self.group_sha256))
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub schema: u8,
    pub identity: RecordId,
    pub status: u16,
    pub content_type: String,
    pub raw_length: usize,
    pub pagination: Option<Pagination>,
    pub fetch_group: Option<FetchGroupRef>,
}
impl Envelope {
    pub fn validate(&self, limits: &Limits) -> Result<(), Error> {
        limits.validate()?;
        self.identity.validate()?;
        if self.schema != 2
            || !(200..=299).contains(&self.status)
            || self.content_type.is_empty()
            || self.content_type.len() > 128
            || self.content_type.bytes().any(|b| b.is_ascii_control())
            || self.raw_length > limits.raw_bytes
        {
            return Err(Error::Invalid("envelope"));
        }
        if let Some(group) = &self.fetch_group {
            group.descriptor_key()?;
        }
        if let Some(p) = &self.pagination
            && (p.page == 0 || p.pages == 0 || p.page > p.pages || p.pages > 10000)
        {
            return Err(Error::Invalid("pagination"));
        }
        Ok(())
    }
}
#[derive(Debug, Clone)]
pub struct RawRecord {
    pub envelope: Envelope,
    pub bytes: Arc<[u8]>,
}
impl RawRecord {
    #[allow(clippy::too_many_arguments)] // Explicit provider envelope; no hidden defaults for identity fields.
    pub fn new(
        source: &str,
        kind: &str,
        key: &ProviderKey,
        period: Period,
        fetched_at_ms: u64,
        status: u16,
        content_type: &str,
        pagination: Option<Pagination>,
        bytes: Arc<[u8]>,
        limits: &Limits,
    ) -> Result<Self, Error> {
        let identity = RecordId {
            source: source.into(),
            kind: kind.into(),
            key_sha256: sha256(&key.canonical_bytes()?),
            period,
            fetched_at_ms,
            raw_sha256: sha256(&bytes),
        };
        let envelope = Envelope {
            schema: 2,
            identity,
            status,
            content_type: content_type.into(),
            raw_length: bytes.len(),
            pagination,
            fetch_group: None,
        };
        envelope.validate(limits)?;
        Ok(Self { envelope, bytes })
    }
    pub fn prepare(&self, limits: &Limits) -> Result<PreparedRecord, Error> {
        self.envelope.validate(limits)?;
        if self.bytes.len() != self.envelope.raw_length
            || sha256(&self.bytes) != self.envelope.identity.raw_sha256
        {
            return Err(Error::Invalid("raw identity"));
        }
        let mut gzip = GzBuilder::new().mtime(0).operating_system(255).write(
            CappedBuffer {
                bytes: Vec::new(),
                maximum: limits.gzip_bytes,
            },
            Compression::new(3),
        );
        gzip.write_all(&self.bytes)
            .map_err(|_| Error::Invalid("gzip"))?;
        let body = gzip
            .finish()
            .map_err(|_| Error::Invalid("gzip/limit"))?
            .bytes;
        if body.len() > limits.gzip_bytes {
            return Err(Error::Invalid("compressed limit"));
        }
        let metadata: BTreeMap<String, String> = BTreeMap::from([
            (
                "s2-record".into(),
                STANDARD.encode(
                    serde_json::to_vec(&self.envelope)
                        .map_err(|_| Error::Invalid("envelope serialization"))?,
                ),
            ),
            ("s2-gzip-sha256".into(), sha256(&body)),
        ]);
        if metadata
            .iter()
            .map(|(k, v)| k.len() + v.len())
            .sum::<usize>()
            > 2048
        {
            return Err(Error::Invalid("metadata limit"));
        }
        Ok(PreparedRecord {
            key: self.envelope.identity.object_key()?,
            metadata,
            md5: STANDARD.encode(Md5::digest(&body)),
            body,
        })
    }
}
#[derive(Debug, Clone)]
pub struct PreparedRecord {
    pub key: String,
    pub metadata: BTreeMap<String, String>,
    pub md5: String,
    pub body: Vec<u8>,
}
/// Exactly one gzip member and no trailing bytes; envelope/key/full hashes all agree.
pub fn decode(
    key: &str,
    object: Object,
    expected: &RecordId,
    limits: &Limits,
) -> Result<RawRecord, Error> {
    limits.validate()?;
    expected.validate()?;
    if key != expected.object_key()?
        || object.length != object.body.len()
        || object.length > limits.gzip_bytes
        || object.metadata.len() != 2
    {
        return Err(Error::Corrupt("object length/key/metadata"));
    }
    let encoded = object
        .metadata
        .get("s2-record")
        .ok_or(Error::Corrupt("missing envelope"))?;
    if encoded.len() > 1900 {
        return Err(Error::Corrupt("envelope size"));
    }
    let json = STANDARD
        .decode(encoded)
        .map_err(|_| Error::Corrupt("envelope encoding"))?;
    let envelope: Envelope =
        serde_json::from_slice(&json).map_err(|_| Error::Corrupt("envelope json"))?;
    envelope
        .validate(limits)
        .map_err(|_| Error::Corrupt("envelope"))?;
    if &envelope.identity != expected
        || STANDARD.encode(serde_json::to_vec(&envelope).map_err(|_| Error::Corrupt("envelope"))?)
            != *encoded
        || object.metadata.get("s2-gzip-sha256") != Some(&sha256(&object.body))
    {
        return Err(Error::Corrupt("identity/hash"));
    }
    let mut decoder = GzDecoder::new(Cursor::new(&object.body));
    let mut bytes = Vec::new();
    decoder
        .by_ref()
        .take((limits.raw_bytes as u64) + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::Corrupt("gzip"))?;
    if bytes.len() > limits.raw_bytes
        || bytes.len() != envelope.raw_length
        || decoder.into_inner().position() != object.length as u64
        || sha256(&bytes) != expected.raw_sha256
    {
        return Err(Error::Corrupt("raw/member limit/hash"));
    }
    Ok(RawRecord {
        envelope,
        bytes: bytes.into(),
    })
}
