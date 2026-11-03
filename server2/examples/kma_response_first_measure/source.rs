//! Test-owned, latest-only adapter. Weather folds and response assembly are native.
use super::pending::{Pending, Validated};
use serde_json::Value;
use server2::{
    domestic::kma::{
        DbVersion, KmaRequest, KmaStore, MidModel, StoreResult, TownModel,
        backend::{KmaSource, SourceAnswer},
        source::{self, Coord, Doc, Family, Fetched, S3Source},
    },
    gateway::{BoxFuture, OrderedJson},
    history::IndexListing,
    storage::{
        CatalogId, CatalogStore, CatalogTransport, ControlObject, Error, ListPage, LookupOutcome,
        Object, ObjectTransport, PreparedRecord, RawRecord, WriteCondition,
    },
};
use std::{collections::HashMap, sync::Arc};
use tokio::time::Instant;

/// Supplies only static/default callbacks; never claims a fake published weather group.
#[derive(Clone)]
pub struct Empty;
impl ObjectTransport for Empty {
    async fn put(&self, _: &PreparedRecord) -> Result<u16, Error> {
        Err(Error::Invalid("empty read-only context"))
    }
    async fn head(&self, _: &str) -> Result<Object, Error> {
        Err(Error::NotFound)
    }
    async fn get(&self, _: &str, _: usize) -> Result<Object, Error> {
        Err(Error::NotFound)
    }
}
impl CatalogTransport for Empty {
    async fn get_control(&self, _: &str, _: usize) -> Result<ControlObject, Error> {
        Err(Error::NotFound)
    }
    async fn put_control(&self, _: &str, _: &[u8], _: &WriteCondition) -> Result<u16, Error> {
        Err(Error::Invalid("empty read-only context"))
    }
    async fn list_raw_document(
        &self,
        _: &str,
        _: Option<&str>,
        _: usize,
        _: usize,
    ) -> Result<Vec<u8>, Error> {
        Ok(br#"<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><KeyCount>0</KeyCount></ListBucketResult>"#.to_vec())
    }
}
impl IndexListing for Empty {
    async fn list_index(&self, _: &str, _: Option<&str>) -> Result<ListPage, Error> {
        Ok(ListPage {
            keys: vec![],
            next: None,
        })
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct Target {
    pub name: String,
    pub catalog: CatalogId,
    pub raw_keys: Vec<String>,
}
pub struct Provider<T> {
    pub base: S3Source<Empty>,
    pub pending: Arc<Pending>,
    pub store: Arc<CatalogStore<T>>,
}
impl<T: CatalogTransport + Clone> KmaSource for Provider<T> {
    fn snapshot(&self, request: &KmaRequest, deadline: Instant) -> BoxFuture<'_, SourceAnswer> {
        let request = request.clone();
        Box::pin(async move {
            self.pending.start(self.store.clone());
            let (base, groups) =
                tokio::join!(self.base.snapshot(&request, deadline), self.pending.ready());
            match (base, groups) {
                (SourceAnswer::Snapshot(base), Ok(groups)) => {
                    let raw: Vec<_> = groups
                        .iter()
                        .map(|g| (g.name.clone(), g.records().to_vec()))
                        .collect();
                    SourceAnswer::Snapshot(Box::new(Overlay::new(base, &raw, true)))
                }
                (SourceAnswer::Snapshot(_), Err(e)) => SourceAnswer::Failed(e),
                (other, _) => other,
            }
        })
    }
}
pub struct Restore<T> {
    pub base: S3Source<Empty>,
    pub store: Arc<CatalogStore<T>>,
    pub targets: Vec<Target>,
}
impl<T: CatalogTransport + Clone> KmaSource for Restore<T> {
    fn snapshot(&self, request: &KmaRequest, deadline: Instant) -> BoxFuture<'_, SourceAnswer> {
        use futures_util::{StreamExt, stream};
        let request = request.clone();
        Box::pin(async move {
            let reads = stream::iter(self.targets.clone())
                .map(|t| async move {
                    match self.store.lookup(&t.catalog, deadline).await {
                        Ok(LookupOutcome::Ready(set))
                            if set.excluded_groups() == 0 && set.acquisitions().len() == 1 =>
                        {
                            let records = set.acquisitions()[0].records();
                            let mut actual: Vec<_> = records
                                .iter()
                                .map(|r| {
                                    r.envelope
                                        .identity
                                        .object_key()
                                        .expect("validated raw identity")
                                })
                                .collect();
                            actual.sort();
                            if actual != t.raw_keys {
                                return Err("restored RawId set differs".to_owned());
                            }
                            Ok((t.name, records.to_vec()))
                        }
                        _ => Err("target is missing/incomplete or ambiguous".to_owned()),
                    }
                })
                .buffer_unordered(4)
                .collect::<Vec<_>>();
            let (base, raw) = tokio::join!(self.base.snapshot(&request, deadline), reads);
            match base {
                SourceAnswer::Snapshot(base) => {
                    match raw.into_iter().collect::<Result<Vec<_>, _>>() {
                        Ok(raw) => {
                            SourceAnswer::Snapshot(Box::new(Overlay::new(base, &raw, false)))
                        }
                        Err(e) => SourceAnswer::Failed(e),
                    }
                }
                other => other,
            }
        })
    }
}
pub fn targets(groups: &[Validated]) -> Vec<Target> {
    groups
        .iter()
        .map(|g| Target {
            name: g.name.clone(),
            catalog: g.catalog(),
            raw_keys: {
                let mut keys: Vec<_> = g
                    .records()
                    .iter()
                    .map(|r| {
                        r.envelope
                            .identity
                            .object_key()
                            .expect("validated raw identity")
                    })
                    .collect();
                keys.sort();
                keys
            },
        })
        .collect()
}

fn fetched(records: &[RawRecord], now: f64, own: bool) -> Option<Fetched> {
    let mut records = records.to_vec();
    records.sort_by_key(|r| r.envelope.pagination.as_ref().map_or(1, |p| p.page));
    let first = records.first()?;
    let actual = records
        .iter()
        .map(|r| r.envelope.identity.fetched_at_ms)
        .max()?;
    Some(Fetched {
        raw_ids: records
            .iter()
            .map(|r| r.envelope.identity.object_key().ok())
            .collect::<Option<Vec<_>>>()?,
        fetched_at_ms: if own { actual.min(now as u64) } else { actual },
        partition: format!(
            "{:08}-{}",
            first.envelope.identity.period.local_date, first.envelope.identity.period.slot
        ),
        pages: records.iter().map(|r| r.bytes.clone()).collect(),
    })
}
struct Overlay {
    base: Box<dyn KmaStore + Send>,
    town: HashMap<TownModel, Vec<Doc>>,
    mid: HashMap<(MidModel, String), Vec<Doc>>,
}
fn list(d: &[Doc]) -> StoreResult {
    Ok(OrderedJson::Array(d.iter().map(Doc::json).collect()))
}
impl Overlay {
    fn new(base: Box<dyn KmaStore + Send>, raw: &[(String, Vec<RawRecord>)], own: bool) -> Self {
        let now = base.as_of_ms().expect("native base snapshot clock");
        let mut town = HashMap::new();
        let mut mid = HashMap::new();
        let coord = Coord { mx: 60., my: 127. };
        for (name, records) in raw {
            let Some(f) = fetched(records, now, own) else {
                continue;
            };
            match name.as_str() {
                "current" => {
                    town.insert(
                        TownModel::Current,
                        source::grid_documents(Family::Current, coord, &[f], now),
                    );
                }
                "shortest" => {
                    town.insert(
                        TownModel::Shortest,
                        source::grid_documents(Family::Shortest, coord, &[f], now),
                    );
                }
                "short" => {
                    town.insert(
                        TownModel::Short,
                        source::grid_documents(Family::Short, coord, &[f], now),
                    );
                }
                "rss" => {
                    town.insert(TownModel::ShortRss, source::rss_documents(coord, &[f], now));
                }
                "mid-forecast" | "mid-land" | "mid-temperature" => {
                    let (model, id) = match name.as_str() {
                        "mid-forecast" => (MidModel::Forecast, "108"),
                        "mid-land" => (MidModel::Land, "11B00000"),
                        _ => (MidModel::Temp, "11B10101"),
                    };
                    mid.insert(
                        (model, id.into()),
                        source::mid_documents(model, id, &[f], now),
                    );
                }
                _ => {}
            }
        }
        Self { base, town, mid }
    }
}
// Every nonweather callback delegates to an actual native empty-context snapshot.
impl KmaStore for Overlay {
    fn db_version(&self) -> DbVersion {
        self.base.db_version()
    }
    fn towns(&self) -> StoreResult {
        self.base.towns()
    }
    fn town(&self, a: &str, b: &str, c: &str) -> StoreResult {
        self.base.town(a, b, c)
    }
    fn region_code(&self, a: &str, b: &str) -> StoreResult {
        self.base.region_code(a, b)
    }
    fn town_model(&self, m: TownModel, x: &Value, y: &Value) -> StoreResult {
        if x.as_f64() == Some(60.)
            && y.as_f64() == Some(127.)
            && let Some(d) = self.town.get(&m)
        {
            list(d)
        } else {
            self.base.town_model(m, x, y)
        }
    }
    fn mid_model(&self, m: MidModel, id: &Value) -> StoreResult {
        if let Some(d) = id.as_str().and_then(|s| self.mid.get(&(m, s.into()))) {
            list(d)
        } else {
            self.base.mid_model(m, id)
        }
    }
    fn forecast_zone(&self, a: &str, b: &str) -> StoreResult {
        self.base.forecast_zone(a, b)
    }
    fn stn_hourly_and_min_rns(&self, a: &Value, b: &str, c: &Value) -> StoreResult {
        self.base.stn_hourly_and_min_rns(a, b, c)
    }
    fn city_hourly(&self, a: &Value) -> StoreResult {
        self.base.city_hourly(a)
    }
    fn history(&self, a: &Value) -> StoreResult {
        self.base.history(a)
    }
    fn area_no(&self, a: &str, b: &str, c: &str) -> StoreResult {
        self.base.area_no(a, b, c)
    }
    fn area_no_near(&self, a: &Value) -> StoreResult {
        self.base.area_no_near(a)
    }
    fn life_index(&self, a: f64) -> StoreResult {
        self.base.life_index(a)
    }
    fn food_poisoning(&self, a: &str, b: &str, c: &str, d: &str) -> StoreResult {
        self.base.food_poisoning(a, b, c, d)
    }
    fn arpltn(&self, a: &Value, b: f64) -> StoreResult {
        self.base.arpltn(a, b)
    }
    fn dust_forecast(&self, a: &str, b: &str, c: &str) -> StoreResult {
        self.base.dust_forecast(a, b, c)
    }
    fn air_fallback(&self, a: &Value, b: f64) -> StoreResult {
        self.base.air_fallback(a, b)
    }
    fn air_forecast(&self, a: &str, b: &Value) -> StoreResult {
        self.base.air_forecast(a, b)
    }
    fn rise_set(&self, a: &Value, b: &[String]) -> StoreResult {
        self.base.rise_set(a, b)
    }
    fn special_zones(&self, a: &[String]) -> StoreResult {
        self.base.special_zones(a)
    }
    fn as_of_ms(&self) -> Option<f64> {
        self.base.as_of_ms()
    }
    fn unconsumed(&self) -> Option<String> {
        self.base.unconsumed()
    }
    // Pending inputs must never produce durable summaries or dependency tokens.
}
