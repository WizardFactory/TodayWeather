//! S3 identities for warning acquisitions and in-memory derivation of legacy documents.
//! Raw bytes are exact provider/export bytes; no derived bulletin or zone state is stored.
use super::{
    js::{self, key, ostr},
    provider::{self, Operation},
    text,
};
use crate::{
    gateway::OrderedJson,
    storage::{
        CatalogId, CatalogLimits, Error, GroupDeclaration, GroupMember, Pagination, Period,
        ProviderKey, RawRecord, sha256,
    },
};
use serde_json::Value;
use std::sync::Arc;

pub const SOURCE: &str = "kma-warning";
pub const ZONE_KIND: &str = "pwn-cd";
pub const ZONE_SEED_KIND: &str = "zone-seed";
pub const SEED_PARTITION: &str = "seed";
pub const SEED_DATE: u32 = 19700101;
pub const LEGACY_SPECIAL_ROLE: &str = "legacy-special";
pub const LEGACY_ZONE_ROLE: &str = "legacy-zone";
const CONTENT_PREFIX: &str = "application/json; tw-role=";

pub fn provider_key() -> ProviderKey {
    ProviderKey::Named {
        id: "national".into(),
    }
}
pub fn key_sha256() -> String {
    sha256(
        &provider_key()
            .canonical_bytes()
            .expect("static provider key"),
    )
}
/// Legacy types 1 special, 2 preliminary special, 3 weather information, 4 weather flash.
pub fn bulletin_kind(kind: u8) -> &'static str {
    match kind {
        1 => "bulletin-1",
        2 => "bulletin-2",
        3 => "bulletin-3",
        _ => "bulletin-4",
    }
}
pub fn summary_operation(kind: u8) -> Option<Operation> {
    match kind {
        2 => Some(Operation::WthrPwn),
        3 => Some(Operation::WthrInfo),
        4 => Some(Operation::BrkNews),
        _ => None,
    }
}
fn slot(kind: &str) -> &'static str {
    match kind {
        ZONE_KIND => "day",
        ZONE_SEED_KIND => "seed",
        _ => "announcement",
    }
}
pub fn period(kind: &str, date: u32) -> Period {
    Period {
        local_date: date,
        slot: slot(kind).into(),
    }
}
pub fn partition(date: u32) -> String {
    format!("{date:08}")
}
pub fn catalog(kind: &str, date: u32) -> Result<CatalogId, Error> {
    let out = CatalogId {
        source: SOURCE.into(),
        kind: kind.into(),
        key_sha256: key_sha256(),
        partition: if kind == ZONE_SEED_KIND {
            SEED_PARTITION.into()
        } else {
            partition(date)
        },
    };
    out.validate()?;
    Ok(out)
}
pub fn content_type(role: &str) -> String {
    format!("{CONTENT_PREFIX}{role}")
}
pub fn role(record: &RawRecord) -> Option<&str> {
    record.envelope.content_type.strip_prefix(CONTENT_PREFIX)
}
/// One page to publish: role, exact bytes and its fetch time.
#[derive(Clone, Debug)]
pub struct Member {
    pub role: String,
    pub bytes: Arc<[u8]>,
    pub fetched_at_ms: u64,
}
/// A single-owner fetch group with ordered complete pages.
pub fn group(
    kind: &str,
    date: u32,
    members: Vec<Member>,
    limits: &CatalogLimits,
) -> Result<(GroupDeclaration, Vec<RawRecord>), Error> {
    let id = catalog(kind, date)?;
    let pages = u32::try_from(members.len()).map_err(|_| Error::Invalid("pages"))?;
    let mut records = Vec::new();
    let mut declared = Vec::new();
    for (i, m) in members.into_iter().enumerate() {
        let record = RawRecord::new(
            SOURCE,
            kind,
            &provider_key(),
            period(kind, date),
            m.fetched_at_ms,
            200,
            &content_type(&m.role),
            Some(Pagination {
                page: i as u32 + 1,
                pages,
                complete: true,
            }),
            m.bytes,
            &limits.raw,
        )?;
        declared.push(GroupMember {
            envelope: record.envelope.clone(),
            catalogs: vec![id.clone()],
        });
        records.push(record);
    }
    Ok((GroupDeclaration::new(declared, limits)?, records))
}
pub fn members_from_pages(pages: &[provider::Page]) -> Vec<Member> {
    pages
        .iter()
        .map(|p| Member {
            role: p.operation.role().into(),
            bytes: p.body.clone(),
            fetched_at_ms: p.fetched_at_ms,
        })
        .collect()
}
/// A legacy `KmaSpecialWeatherSituation` document with its stored announcement instant.
#[derive(Clone, Debug)]
pub struct Bulletin {
    pub kind: u8,
    /// KST wall clock stored as UTC milliseconds, as legacy stores `announcement`.
    pub stored_ms: i64,
    pub doc: OrderedJson,
}
impl Bulletin {
    pub fn date(&self) -> u32 {
        js::ymd(self.stored_ms)
    }
}
fn page_items(records: &[RawRecord], wanted: &str) -> Result<Vec<Value>, Error> {
    let mut out = Vec::new();
    for r in records.iter().filter(|r| role(r) == Some(wanted)) {
        match provider::items(&r.bytes) {
            Ok(Some(items)) => out.extend(items),
            Ok(None) => {}
            Err(_) => return Err(Error::Corrupt("warning page")),
        }
    }
    Ok(out)
}
fn object(fields: Vec<(&str, OrderedJson)>) -> OrderedJson {
    OrderedJson::Object(fields.into_iter().map(|(k, v)| (key(k), v)).collect())
}
fn situations(list: Vec<text::Situation>) -> OrderedJson {
    OrderedJson::Array(list.iter().map(text::Situation::to_json).collect())
}
/// Provider-derived documents use the S02 seed shape (type, announcement, situationList,
/// comment, bulletin). Production key order of newly collected documents is unverified.
fn provider_doc(
    kind: u8,
    stored_ms: i64,
    list: Vec<text::Situation>,
    comment: String,
    bulletin: Option<OrderedJson>,
) -> OrderedJson {
    let mut fields = vec![
        ("type", OrderedJson::Number(f64::from(kind))),
        ("announcement", ostr(&js::iso(stored_ms))),
        ("situationList", situations(list)),
        ("comment", ostr(&comment)),
    ];
    if let Some(b) = bulletin {
        fields.push(("bulletin", b));
    }
    object(fields)
}
/// Legacy documents derived from one complete acquisition. `None` when no item exists.
pub fn derive(kind: u8, records: &[RawRecord]) -> Result<Option<Bulletin>, Error> {
    let first = records.first().ok_or(Error::Corrupt("empty acquisition"))?;
    if role(first) == Some(LEGACY_SPECIAL_ROLE) {
        if records.len() != 1 {
            return Err(Error::Corrupt("seed acquisition"));
        }
        return legacy_doc(kind, &first.bytes).map(Some);
    }
    match kind {
        1 => {
            let status_items = page_items(records, Operation::PwnStatus.role())?;
            let Some(status) = provider::latest_item(&status_items) else {
                return Ok(None);
            };
            let stored_ms =
                provider::announcement_of(status.get("tmFc")).ok_or(Error::Corrupt("tmFc"))?;
            let messages = page_items(records, Operation::WrnMsg.role())?;
            let bulletin = messages.iter().find(|item| {
                super::zones::same_text(item.get("tmFc"), status.get("tmFc"))
                    && (item.get("tmSeq").is_none()
                        || super::zones::same_text(item.get("tmSeq"), status.get("tmSeq")))
            });
            let bulletin = bulletin.map(|b| {
                object(vec![
                    ("title", ostr(&text::clean_text(b.get("t1")))),
                    ("areas", ostr(&text::clean_text(b.get("t2")))),
                    ("effectiveTimes", ostr(&text::clean_text(b.get("t3")))),
                    ("releaseOutlook", ostr(&text::clean_text(b.get("t4")))),
                ])
            });
            Ok(Some(Bulletin {
                kind,
                stored_ms,
                doc: provider_doc(
                    1,
                    stored_ms,
                    text::parse_special_text(&js::text(status.get("t6"))),
                    text::clean_text(status.get("other")),
                    bulletin,
                ),
            }))
        }
        2..=4 => {
            let op = summary_operation(kind).unwrap();
            let all = page_items(records, op.role())?;
            let Some(item) = provider::latest_item(&all) else {
                return Ok(None);
            };
            let stored_ms =
                provider::announcement_of(item.get("tmFc")).ok_or(Error::Corrupt("tmFc"))?;
            let (list, comment) = match kind {
                2 => (
                    text::parse_preliminary_text(&js::text(item.get("pwn"))),
                    text::clean_text(item.get("rem")),
                ),
                3 => (vec![], text::clean_text(item.get("t1"))),
                _ => (vec![], text::clean_text(item.get("ann"))),
            };
            Ok(Some(Bulletin {
                kind,
                stored_ms,
                doc: provider_doc(kind, stored_ms, list, comment, None),
            }))
        }
        _ => Err(Error::Invalid("warning type")),
    }
}
/// A canonical exported legacy document (JSON object with numeric `type` and ISO `announcement`).
pub fn legacy_doc(kind: u8, bytes: &[u8]) -> Result<Bulletin, Error> {
    let doc = OrderedJson::parse(bytes).map_err(|_| Error::Corrupt("seed JSON"))?;
    if !matches!(doc, OrderedJson::Object(_)) {
        return Err(Error::Corrupt("seed document"));
    }
    if doc.get("type").and_then(OrderedJson::number) != Some(f64::from(kind)) {
        return Err(Error::Corrupt("seed type"));
    }
    let stored_ms = doc
        .get("announcement")
        .and_then(OrderedJson::string)
        .and_then(|s| js::parse_iso(&s))
        .ok_or(Error::Corrupt("seed announcement"))?;
    Ok(Bulletin {
        kind,
        stored_ms,
        doc,
    })
}
/// Legacy zone export documents (state entries and the `_sync` marker) of a seed record.
pub fn zone_seed(records: &[RawRecord]) -> Result<Vec<Value>, Error> {
    let [record] = records else {
        return Err(Error::Corrupt("zone seed acquisition"));
    };
    if role(record) != Some(LEGACY_ZONE_ROLE) {
        return Err(Error::Corrupt("zone seed role"));
    }
    match serde_json::from_slice(&record.bytes) {
        Ok(Value::Array(docs)) => Ok(docs),
        _ => Err(Error::Corrupt("zone seed JSON")),
    }
}
/// All getPwnCd rows of an acquisition, in page order.
pub fn zone_rows(records: &[RawRecord]) -> Result<Vec<Value>, Error> {
    page_items(records, Operation::PwnCd.role())
}
