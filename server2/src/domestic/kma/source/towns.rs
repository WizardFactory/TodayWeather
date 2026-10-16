//! S15b-4b2 address-derived town resolution. Provider and persistence integration follows the
//! legacy `_findTown` and `geo.name2address` contracts; precise reverse lookups are not stored.
use serde_json::{Value, json};

/// The name2address component rewrite; prior is the parameters after the KR component swap.
/// `split(' ')` deliberately preserves empty components, as JavaScript String.split does.
pub fn remap_address(address: &str, prior: &Value) -> Value {
    let parts: Vec<_> = address.split(' ').collect();
    let mut out = prior.as_object().cloned().unwrap_or_default();
    out.remove("region");
    if let Some(region) = parts.get(1) {
        out.insert("region".into(), Value::String((*region).into()));
    }
    let mut set = |key: &str, value: String| {
        out.insert(key.into(), Value::String(value));
    };
    match parts.as_slice() {
        [_, _, city] => set("city", (*city).into()),
        [_, _, city, last] => match last.chars().last() {
            Some('시' | '군' | '구') => set("city", format!("{city}{last}")),
            // 읍/면/동 and legacy's unknown suffix follow the same assignments.
            _ => {
                set("city", (*city).into());
                set("town", (*last).into());
            }
        },
        [_, _, city, district, town] => {
            set("city", format!("{city}{district}"));
            set("town", (*town).into());
        }
        _ => (),
    }
    Value::Object(out)
}
fn number(v: &Value) -> f64 {
    match v {
        Value::String(s) => s.trim().parse().unwrap_or(f64::NAN),
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        _ => f64::NAN,
    }
}
fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(v) => *v,
        Value::String(v) => !v.is_empty(),
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.),
        _ => true,
    }
}
/// The transient newTown before Mongo save/casting, from convertGeocode's typed coordinates.
/// Coordinates are cloned as strings or numbers; numeric comparison must not normalize them.
pub fn added_town(converted: &Value, names: &Value, list: &[Value]) -> Value {
    let mut town = json!({
        "gCoord": {"lat": converted["lat"], "lon": converted["lon"]},
        "mCoord": {"my": converted["my"], "mx": converted["mx"]},
        "town": names,
    });
    let lat = number(&converted["lat"]);
    let lon = number(&converted["lon"]);
    if !((32.6942..=39.3769).contains(&lat) && (123.9523..=131.88).contains(&lon)) {
        return town;
    }
    // Legacy breaks at the first matching grid even if it has no areaNo, then tries the
    // first matching region/city. It does not search later matching rows for a better value.
    let grid = list.iter().find(|row| {
        row["mCoord"]["mx"]
            .as_f64()
            .is_some_and(|v| Some(v) == converted["mx"].as_f64())
            && row["mCoord"]["my"]
                .as_f64()
                .is_some_and(|v| Some(v) == converted["my"].as_f64())
    });
    let area = grid.and_then(|row| row.get("areaNo")).filter(|v| truthy(v));
    let area = area.or_else(|| {
        list.iter()
            .find(|row| {
                row["town"].get("first") == names.get("first")
                    && row["town"].get("second") == names.get("second")
            })
            .and_then(|row| row.get("areaNo"))
            .filter(|v| truthy(v))
    });
    if let Some(area) = area {
        town["areaNo"] = area.clone();
    }
    town
}

use crate::geocode::town::{Acquire, Operation};
use crate::resolver::{OwnedConfig, OwnedFlights, Waited};
use crate::storage::{CatalogTransport, Error as StorageError, WriteCondition, sha256};
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
use tokio::time::Instant;

const CAP: usize = 16 * 1024;
/// Includes bounded S3 reads, the owned provider chain and confirmed conditional publication.
const OWNED: Duration = Duration::from_secs(21);
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ResolveError {
    Provider,
    Storage,
    Late,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Projection {
    schema: u8,
    operation: String,
    stage: String,
    address: String,
    fetched_at_ms: u64,
    result: Value,
    result_sha256: String,
}
fn operation_name(op: Operation) -> &'static str {
    match op {
        Operation::Town => "town",
        Operation::Remap => "remap",
    }
}
fn identity(op: Operation, address: &str) -> Result<String, ResolveError> {
    if address.is_empty()
        || address.encode_utf16().count() > 200
        || !address.chars().any(char::is_alphabetic)
        || address.chars().any(char::is_control)
    {
        return Err(ResolveError::Provider);
    }
    let hash = sha256(format!("{}\0{address}", operation_name(op)).as_bytes());
    Ok(format!(
        "index/v2/town-address/{}/{hash}.json",
        operation_name(op)
    ))
}
fn valid(op: Operation, result: &Value) -> bool {
    let Some(fields) = result.as_object() else {
        return false;
    };
    match op {
        Operation::Town => {
            fields.len() == 3
                && matches!(result["provider"].as_str(), Some("google" | "kakao"))
                && result["lat"]
                    .as_f64()
                    .is_some_and(|n| (-90. ..=90.).contains(&n))
                && result["lon"]
                    .as_f64()
                    .is_some_and(|n| (-180. ..=180.).contains(&n))
        }
        Operation::Remap => {
            fields.len() == 2
                && result["provider"] == "google"
                && result["address"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty() && s.len() < CAP / 2)
        }
    }
}
/// Bounded owned address acquisition and safe permitted S3 projections. Unlike raw weather
/// records these are deliberately projected address metadata, never reverse-coordinate bodies.
/// Town coordinates are canonical numeric reference metadata (AK bug correction) as Mongo
/// casts them; remap projections
/// use the existing product geocode month's freshness bound.
pub struct Resolver<T> {
    transport: T,
    acquire: Option<Arc<dyn Acquire>>,
    clock: Option<Arc<dyn Fn() -> u64 + Send + Sync>>,
    owned: OwnedFlights<String, Result<Value, ResolveError>>,
}
impl<T: CatalogTransport + Clone + Send + Sync + 'static> Resolver<T> {
    pub fn new(transport: T, acquire: Option<Arc<dyn Acquire>>) -> Self {
        Self {
            transport,
            acquire,
            clock: None,
            owned: OwnedFlights::new(OwnedConfig {
                running: 32,
                entries: 4096,
                // Recheck durable freshness on every later request; only running acquisitions share.
                retain: Duration::ZERO,
            })
            .expect("fixed town owner bounds"),
        }
    }
    /// Source clock at completed acquisition/read-back; isolated resolver tests may use their
    /// explicitly supplied request instant when no clock is injected.
    pub fn with_clock(mut self, clock: Arc<dyn Fn() -> u64 + Send + Sync>) -> Self {
        self.clock = Some(clock);
        self
    }
    pub async fn resolve(
        &self,
        op: Operation,
        address: String,
        until: Instant,
        now: u64,
    ) -> Result<Value, ResolveError> {
        let key = identity(op, &address)?;
        let clock = self.clock.clone();
        let transport = self.transport.clone();
        let acquire = self.acquire.clone();
        match self
            .owned
            .join(key.clone(), until, OWNED, move |deadline| async move {
                let old = read(&transport, &key, op, &address, now, deadline).await?;
                if let Some((projection, _)) = &old
                    && (op == Operation::Town
                        || now.saturating_sub(projection.fetched_at_ms) <= 30 * 86_400_000)
                {
                    return Ok(projection.result.clone());
                }
                let acquire = acquire.ok_or(ResolveError::Provider)?;
                let result = acquire
                    .address(op, address.clone())
                    .await
                    .map_err(|_| ResolveError::Provider)?;
                let result = if op == Operation::Town {
                    crate::geocode::town::canonical_location(&result)
                        .map_err(|_| ResolveError::Provider)?
                } else {
                    result
                };
                if !valid(op, &result) {
                    return Err(ResolveError::Provider);
                }
                let projection = Projection {
                    schema: 1,
                    operation: operation_name(op).into(),
                    stage: "address-provider-projection".into(),
                    address: address.clone(),
                    fetched_at_ms: clock.as_ref().map_or(now, |c| c()),
                    result_sha256: sha256(
                        &serde_json::to_vec(&result).map_err(|_| ResolveError::Storage)?,
                    ),
                    result,
                };
                let bytes = serde_json::to_vec(&projection).map_err(|_| ResolveError::Storage)?;
                if bytes.len() > CAP {
                    return Err(ResolveError::Storage);
                }
                let condition = match old {
                    Some((_, tag)) => WriteCondition::Match(tag),
                    None => WriteCondition::Absent,
                };
                let status = tokio::time::timeout_at(
                    deadline,
                    transport.put_control(&key, &bytes, &condition),
                )
                .await
                .map_err(|_| ResolveError::Storage)?
                .map_err(|_| ResolveError::Storage)?;
                if !matches!(status, 200 | 201 | 204 | 412) {
                    return Err(ResolveError::Storage);
                }
                // Even a successful PUT is not admission: read back the winner and validate it.
                let confirmed_now = clock.as_ref().map_or(now, |c| c());
                let winner = read(&transport, &key, op, &address, confirmed_now, deadline)
                    .await?
                    .ok_or(ResolveError::Storage)?;
                Ok(winner.0.result)
            })
            .await
        {
            Waited::Ready(result) => result,
            _ => Err(ResolveError::Late),
        }
    }
}
async fn read<T: CatalogTransport>(
    transport: &T,
    key: &str,
    op: Operation,
    address: &str,
    now: u64,
    deadline: Instant,
) -> Result<Option<(Projection, String)>, ResolveError> {
    let object = match tokio::time::timeout_at(deadline, transport.get_control(key, CAP))
        .await
        .map_err(|_| ResolveError::Storage)?
    {
        Ok(object) => object,
        Err(StorageError::NotFound) => return Ok(None),
        Err(_) => return Err(ResolveError::Storage),
    };
    let projection: Projection =
        serde_json::from_slice(&object.body).map_err(|_| ResolveError::Storage)?;
    if projection.schema != 1
        || projection.operation != operation_name(op)
        || projection.stage != "address-provider-projection"
        || projection.address != address
        || projection.fetched_at_ms > now
        || !valid(op, &projection.result)
        || sha256(&serde_json::to_vec(&projection.result).map_err(|_| ResolveError::Storage)?)
            != projection.result_sha256
    {
        return Err(ResolveError::Storage);
    }
    Ok(Some((projection, object.etag)))
}

/// The legacy transient town document. Persisted provider coordinates retain their source
/// primitive type; field projection into response objects stays in the legacy value layer.
pub(crate) fn town_document(
    result: &Value,
    request: &super::super::KmaRequest,
    list: &[super::Doc],
) -> super::Doc {
    use super::{Doc, Val};
    let (mx, my) = super::grid_of(number(&result["lat"]), number(&result["lon"]));
    let coord = |v: &Value| match v {
        Value::String(s) => Val::str(s),
        _ => Val::num(number(v)),
    };
    let names = Doc::new()
        .with(
            "first",
            request.region.as_ref().map_or(Val::Undef, Val::str),
        )
        .with("second", request.city.as_ref().map_or(Val::Undef, Val::str))
        .with("third", request.town.as_ref().map_or(Val::Undef, Val::str));
    let mut town = Doc::new()
        .with(
            "gCoord",
            Doc::new()
                .with("lat", coord(&result["lat"]))
                .with("lon", coord(&result["lon"]))
                .into(),
        )
        .with(
            "mCoord",
            Doc::new()
                .with("my", Val::num(my))
                .with("mx", Val::num(mx))
                .into(),
        )
        .with("town", names.into());
    let lat = number(&result["lat"]);
    let lon = number(&result["lon"]);
    if (32.6942..=39.3769).contains(&lat) && (123.9523..=131.88).contains(&lon) {
        let area = list
            .iter()
            .find(|row| {
                row.get("mCoord").and_then(Val::as_doc).is_some_and(|m| {
                    m.get("mx").and_then(Val::as_num) == Some(mx)
                        && m.get("my").and_then(Val::as_num) == Some(my)
                })
            })
            .and_then(|row| row.get("areaNo"))
            .filter(|v| match v {
                Val::Str(s) => !s.is_empty(),
                _ => false,
            });
        let area = area.or_else(|| {
            list.iter()
                .find(|row| {
                    row.get("town").and_then(Val::as_doc).is_some_and(|n| {
                        n.get("first").and_then(Val::as_str) == request.region.as_deref()
                            && n.get("second").and_then(Val::as_str) == request.city.as_deref()
                    })
                })
                .and_then(|row| row.get("areaNo"))
                .filter(|v| match v {
                    Val::Str(s) => !s.is_empty(),
                    _ => false,
                })
        });
        if let Some(area) = area {
            town.set("areaNo", area.clone());
        }
    }
    town
}
