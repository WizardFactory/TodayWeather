use super::{Envelope, Error, FetchGroupRef, Limits, RawRecord, RecordId, sha256};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, time::Duration};

#[derive(Debug, Clone)]
pub struct CatalogLimits {
    pub control_bytes: usize,
    pub entries: usize,
    pub members: usize,
    pub partitions: usize,
    pub list_pages: usize,
    pub candidates: usize,
    pub list_keys: usize,
    pub cas_attempts: usize,
    pub retained_control_bytes: usize,
    pub output_bytes: usize,
    pub io: usize,
    pub cpu: usize,
    pub deadline: Duration,
    pub raw: Limits,
}
impl Default for CatalogLimits {
    fn default() -> Self {
        Self {
            control_bytes: 1024 * 1024,
            entries: 2048,
            members: 128,
            partitions: 16,
            list_pages: 8,
            candidates: 2048,
            list_keys: 1000,
            cas_attempts: 4,
            retained_control_bytes: 8 * 1024 * 1024,
            output_bytes: 32 * 1024 * 1024,
            io: 16,
            cpu: 2,
            deadline: Duration::from_secs(3),
            raw: Limits::default(),
        }
    }
}
impl CatalogLimits {
    pub fn validate(&self) -> Result<(), Error> {
        self.raw.validate()?;
        if self.control_bytes == 0
            || self.control_bytes > 4 * 1024 * 1024
            || self.entries == 0
            || self.entries > 8192
            || self.members == 0
            || self.members > 512
            || self.partitions == 0
            || self.partitions > 64
            || self.list_pages == 0
            || self.list_pages > 32
            || self.candidates == 0
            || self.candidates > 8192
            || self.list_keys == 0
            || self.list_keys > 1000
            || self.cas_attempts == 0
            || self.cas_attempts > 8
            || self.retained_control_bytes < self.control_bytes
            || self.retained_control_bytes > 32 * 1024 * 1024
            || self.output_bytes == 0
            || self.output_bytes > 128 * 1024 * 1024
            || self.io == 0
            || self.io > 128
            || self.cpu == 0
            || self.cpu > 64
            || self.deadline.is_zero()
            || self.deadline > Duration::from_secs(9)
        {
            return Err(Error::Invalid("catalog limits"));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogId {
    pub source: String,
    pub kind: String,
    pub key_sha256: String,
    pub partition: String,
}
impl CatalogId {
    pub fn for_record(id: &RecordId, partition: &str) -> Result<Self, Error> {
        id.validate()?;
        let out = Self {
            source: id.source.clone(),
            kind: id.kind.clone(),
            key_sha256: id.key_sha256.clone(),
            partition: partition.into(),
        };
        out.validate()?;
        Ok(out)
    }
    pub fn validate(&self) -> Result<(), Error> {
        let test = RecordId {
            source: self.source.clone(),
            kind: self.kind.clone(),
            key_sha256: self.key_sha256.clone(),
            period: super::Period {
                local_date: 20260101,
                slot: "0000".into(),
            },
            fetched_at_ms: 1,
            raw_sha256: "0".repeat(64),
        };
        test.validate()?;
        if self.partition.is_empty()
            || self.partition.len() > 64
            || !self
                .partition
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err(Error::Invalid("partition"));
        }
        Ok(())
    }
    pub fn key(&self) -> String {
        format!(
            "index/v2/{}/{}/{}/{}.json",
            self.source, self.kind, self.key_sha256, self.partition
        )
    }
    pub fn matches(&self, id: &RecordId) -> bool {
        self.source == id.source && self.kind == id.kind && self.key_sha256 == id.key_sha256
    }
}
fn canonical<T: Serialize>(value: &T) -> Result<Vec<u8>, Error> {
    serde_json::to_vec(value).map_err(|_| Error::Invalid("control serialization"))
}
pub(crate) fn identity_order(e: &Envelope) -> (u64, &str, u32, &str, &str, &str, &str) {
    let id = &e.identity;
    (
        id.fetched_at_ms,
        &id.raw_sha256,
        id.period.local_date,
        &id.period.slot,
        &id.source,
        &id.kind,
        &id.key_sha256,
    )
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalog {
    pub schema: u8,
    pub identity: CatalogId,
    pub generation: u64,
    pub entries: Vec<Envelope>,
}
impl Catalog {
    pub fn empty(identity: CatalogId) -> Self {
        Self {
            schema: 1,
            identity,
            generation: 0,
            entries: vec![],
        }
    }
    pub fn validate(&self, l: &CatalogLimits) -> Result<(), Error> {
        self.identity.validate()?;
        if self.schema != 1 {
            return Err(Error::Corrupt("catalog schema"));
        }
        if self.entries.len() > l.entries {
            return Err(Error::Capacity);
        }
        let mut seen = BTreeSet::new();
        let mut previous = None;
        for entry in &self.entries {
            entry.validate(&l.raw)?;
            if !self.identity.matches(&entry.identity) || !seen.insert(entry.identity.object_key()?)
            {
                return Err(Error::Corrupt("catalog identity/duplicate"));
            }
            let order = identity_order(entry);
            if previous.as_ref().is_some_and(|p| p >= &order) {
                return Err(Error::Corrupt("catalog order"));
            }
            previous = Some(order);
        }
        Ok(())
    }
    pub fn union(&self, incoming: &[Envelope], l: &CatalogLimits) -> Result<Self, Error> {
        self.validate(l)?;
        let mut out = self.clone();
        let mut changed = false;
        for entry in incoming {
            entry.validate(&l.raw)?;
            if !self.identity.matches(&entry.identity) {
                return Err(Error::Invalid("catalog member namespace"));
            }
            if let Some(old) = out.entries.iter().find(|e| e.identity == entry.identity) {
                if old != entry {
                    return Err(Error::Corrupt("immutable envelope conflict"));
                }
            } else {
                out.entries.push(entry.clone());
                changed = true;
            }
        }
        out.entries
            .sort_by(|a, b| identity_order(a).cmp(&identity_order(b)));
        if changed {
            out.generation = out
                .generation
                .checked_add(1)
                .ok_or(Error::Corrupt("generation overflow"))?;
        }
        out.validate(l)?;
        Ok(out)
    }
    pub fn bytes(&self, l: &CatalogLimits) -> Result<Vec<u8>, Error> {
        self.validate(l)?;
        let b = canonical(self)?;
        if b.len() > l.control_bytes {
            return Err(Error::Invalid("catalog bytes"));
        }
        Ok(b)
    }
    pub fn from_bytes(bytes: &[u8], id: &CatalogId, l: &CatalogLimits) -> Result<Self, Error> {
        if bytes.len() > l.control_bytes {
            return Err(Error::Corrupt("catalog bytes"));
        }
        let out: Self =
            serde_json::from_slice(bytes).map_err(|_| Error::Corrupt("catalog JSON"))?;
        out.validate(l)?;
        if &out.identity != id || canonical(&out)? != bytes {
            return Err(Error::Corrupt("catalog canonical identity"));
        }
        Ok(out)
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GroupMember {
    pub envelope: Envelope,
    pub catalogs: Vec<CatalogId>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GroupDeclaration {
    pub schema: u8,
    pub partitions: Vec<CatalogId>,
    pub members: Vec<GroupMember>,
}
impl GroupDeclaration {
    pub fn new(mut members: Vec<GroupMember>, l: &CatalogLimits) -> Result<Self, Error> {
        for m in &mut members {
            m.catalogs.sort();
        }
        let partitions = members
            .iter()
            .flat_map(|m| m.catalogs.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let out = Self {
            schema: 1,
            partitions,
            members,
        };
        out.validate(l)?;
        Ok(out)
    }
    pub fn validate(&self, l: &CatalogLimits) -> Result<(), Error> {
        if self.schema != 1
            || self.members.is_empty()
            || self.members.len() > l.members
            || self.partitions.is_empty()
            || self.partitions.len() > l.partitions
        {
            return Err(Error::Invalid("group bounds/schema"));
        }
        if self.partitions.windows(2).any(|w| w[0] >= w[1]) {
            return Err(Error::Corrupt("group partition order"));
        }
        for p in &self.partitions {
            p.validate()?;
        }
        let first = &self.members[0].envelope.identity;
        let mut union = BTreeSet::new();
        let mut identities = BTreeSet::new();
        let mut bytes = 0usize;
        let pages = self.members[0]
            .envelope
            .pagination
            .as_ref()
            .map(|p| p.pages);
        for (i, m) in self.members.iter().enumerate() {
            m.envelope.validate(&l.raw)?;
            let id = &m.envelope.identity;
            bytes = bytes
                .checked_add(m.envelope.raw_length)
                .ok_or(Error::Invalid("group bytes"))?;
            if m.envelope.fetch_group.is_some()
                || m.catalogs.is_empty()
                || m.catalogs.len() > l.partitions
                || m.catalogs.windows(2).any(|w| w[0] >= w[1])
                || !identities.insert(id.object_key()?)
                || id.source != first.source
                || id.kind != first.kind
                || id.key_sha256 != first.key_sha256
            {
                return Err(Error::Invalid("group member identity/ownership"));
            }
            for c in &m.catalogs {
                c.validate()?;
                if !c.matches(id) {
                    return Err(Error::Invalid("group catalog namespace"));
                }
                union.insert(c.clone());
            }
            match (pages, &m.envelope.pagination) {
                (Some(n), Some(p))
                    if p.complete
                        && p.pages == n
                        && p.page == i as u32 + 1
                        && n as usize == self.members.len() => {}
                (None, None) => {
                    if i > 0
                        && identity_order(&self.members[i - 1].envelope)
                            >= identity_order(&m.envelope)
                    {
                        return Err(Error::Invalid("group member order"));
                    }
                }
                _ => return Err(Error::Invalid("complete ordered pages")),
            }
        }
        if bytes > l.output_bytes {
            return Err(Error::Capacity);
        }
        if union.into_iter().collect::<Vec<_>>() != self.partitions {
            return Err(Error::Invalid("group partition union"));
        }
        Ok(())
    }
    pub fn bytes(&self, l: &CatalogLimits) -> Result<Vec<u8>, Error> {
        self.validate(l)?;
        let b = canonical(self)?;
        if b.len() > l.control_bytes {
            return Err(Error::Invalid("descriptor bytes"));
        }
        Ok(b)
    }
    pub fn reference(&self, l: &CatalogLimits) -> Result<FetchGroupRef, Error> {
        Ok(FetchGroupRef {
            group_sha256: sha256(&self.bytes(l)?),
            member_sha256: sha256(&canonical(&self.members)?),
            partitions_sha256: sha256(&canonical(&self.partitions)?),
            members: self.members.len() as u32,
        })
    }
    pub fn envelopes(&self, l: &CatalogLimits) -> Result<Vec<Envelope>, Error> {
        let r = self.reference(l)?;
        Ok(self
            .members
            .iter()
            .map(|m| {
                let mut e = m.envelope.clone();
                e.fetch_group = Some(r.clone());
                e
            })
            .collect())
    }
    pub fn attach(
        &self,
        records: Vec<RawRecord>,
        l: &CatalogLimits,
    ) -> Result<Vec<RawRecord>, Error> {
        if records.len() != self.members.len() {
            return Err(Error::Invalid("record count"));
        }
        let r = self.reference(l)?;
        records
            .into_iter()
            .zip(&self.members)
            .map(|(record, m)| {
                if record.envelope != m.envelope {
                    return Err(Error::Invalid("member record envelope"));
                }
                record.with_fetch_group(r.clone(), &l.raw)
            })
            .collect()
    }
    pub fn from_bytes(
        bytes: &[u8],
        reference: &FetchGroupRef,
        l: &CatalogLimits,
    ) -> Result<Self, Error> {
        if bytes.len() > l.control_bytes {
            return Err(Error::Corrupt("descriptor bytes"));
        }
        let out: Self =
            serde_json::from_slice(bytes).map_err(|_| Error::Corrupt("descriptor JSON"))?;
        out.validate(l)?;
        if out.reference(l)? != *reference || out.bytes(l)? != bytes {
            return Err(Error::Corrupt("descriptor digest"));
        }
        Ok(out)
    }
}
/// Derived values are returned in memory only. Callers parse each ordered acquisition's pages.
#[derive(Debug, Clone, Copy)]
pub enum SelectionPolicy {
    Earliest,
    Latest,
    AbsentFields,
    ListReplace,
}
pub fn fold_values(
    values: &[serde_json::Value],
    policy: SelectionPolicy,
) -> Result<Option<serde_json::Value>, Error> {
    use serde_json::Value;
    if values.is_empty() {
        return Ok(None);
    }
    match policy {
        SelectionPolicy::Earliest => Ok(values.first().cloned()),
        SelectionPolicy::Latest => Ok(values.last().cloned()),
        SelectionPolicy::ListReplace => {
            if values.iter().any(|v| !v.is_array()) {
                return Err(Error::Invalid("list view"));
            }
            Ok(values.last().cloned())
        }
        SelectionPolicy::AbsentFields => {
            let mut out = serde_json::Map::new();
            for value in values {
                let Value::Object(fields) = value else {
                    return Err(Error::Invalid("field view"));
                };
                for (k, v) in fields {
                    out.entry(k.clone()).or_insert_with(|| v.clone());
                }
            }
            Ok(Some(Value::Object(out)))
        }
    }
}
