//! Durable port of `pushCoordinator/warningFeed.js`. Immutable events precede one CAS head;
//! the first acknowledged feed is silent. Only S12 durably persisted source rows enter here.
use crate::{
    budget::Clock,
    storage::{CatalogTransport, Error, WriteCondition, sha256},
    warnings::{
        js,
        zones::{Event, prepare_events},
    },
    world::js::{Obj, Val},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::Duration,
};
use tokio::sync::Mutex;

pub const PREFIX: &str = "index/v2/push/warning-feed";
const HEAD: &str = "index/v2/push/warning-feed/head.json";
const MAX_OBJECT: usize = 8 * 1024 * 1024;
const DAY: i64 = 86_400_000;
const WINDOW: i64 = 300_000;

/// Legacy `publishedAt`: exactly twelve decimal digits followed by JavaScript Date.UTC,
/// including its month/day normalization and special years 0..99.
pub fn published_at(value: &Value) -> Option<i64> {
    let s = js::string(Some(value));
    if s.len() != 12 || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n = |a, b| s[a..b].parse::<f64>().unwrap();
    let year = n(0, 4);
    let year = if (0.0..=99.0).contains(&year) {
        year + 1900.0
    } else {
        year
    };
    let ms = js::date_utc(year, n(4, 6) - 1., n(6, 8), n(8, 10) - 9., n(10, 12));
    ms.is_finite().then_some(ms as i64)
}
fn hash(values: Vec<Val>) -> String {
    sha256(&Val::Arr(values).to_json())
}
/// Same JSON array and numeric formatting as the actual legacy registry hash.
pub fn event_id(e: &Event) -> String {
    hash(vec![
        Val::Str(e.area_code.clone()),
        Val::Num(e.warn_var),
        Val::Num(e.warn_stress),
        Val::Str(e.command.clone()),
        Val::Num(e.tm_fc),
        Val::Num(e.tm_seq),
        Val::Num(e.end_time),
        Val::Num(e.all_end_time),
    ])
}
pub fn group_id(e: &Event) -> String {
    hash(vec![
        Val::Num(e.tm_fc),
        Val::Num(e.tm_seq),
        Val::Num(e.warn_var),
        Val::Num(e.warn_stress),
        Val::Str(e.command.clone()),
        Val::Num(e.end_time),
    ])
}
pub fn event_value(e: &Event) -> Value {
    let mut o = Obj::new();
    o.set("areaCode", e.area_code.clone());
    o.set("areaName", e.area_name.clone());
    o.set("warnVar", e.warn_var);
    o.set("warnStress", e.warn_stress);
    o.set("command", e.command.clone());
    o.set("cancel", e.cancel);
    o.set("tmFc", e.tm_fc);
    o.set("tmSeq", e.tm_seq);
    o.set("endTime", e.end_time);
    o.set("allEndTime", e.all_end_time);
    o.set("rank", e.rank);
    serde_json::from_slice(&Val::Obj(o).to_json()).expect("finite normalized warning event")
}
fn valid_id(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Reference {
    id: String,
    at: i64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Head {
    schema_version: u32,
    events: Vec<Reference>,
    seen: Vec<String>,
    baseline: bool,
    updated_at: i64,
}
impl Default for Head {
    fn default() -> Self {
        Self {
            schema_version: 1,
            events: Vec::new(),
            seen: Vec::new(),
            baseline: false,
            updated_at: 0,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub event: Value,
    pub observed_at: i64,
    pub source_at: Option<i64>,
    pub notify: bool,
}
impl Item {
    pub fn normalized(&self) -> Result<Event, Error> {
        let e = prepare_events(std::slice::from_ref(&self.event))
            .into_iter()
            .next()
            .ok_or(Error::Corrupt("warning event"))?;
        if !valid_id(&self.id)
            || event_id(&e) != self.id
            || published_at(&self.event["tmFc"]) != self.source_at
        {
            return Err(Error::Corrupt("warning event identity"));
        }
        Ok(e)
    }
}
fn parse_head(bytes: &[u8]) -> Result<Head, Error> {
    let h: Head = serde_json::from_slice(bytes).map_err(|_| Error::Corrupt("warning feed head"))?;
    if h.schema_version != 1
        || h.seen.len() > 50_000
        || h.seen.iter().any(|s| !valid_id(s))
        || h.events.iter().any(|r| !valid_id(&r.id))
    {
        return Err(Error::Corrupt("warning feed head"));
    }
    Ok(h)
}

pub struct WarningFeed<T> {
    transport: Arc<T>,
    clock: Arc<dyn Clock>,
    tail: Mutex<()>,
    cache: Mutex<HashMap<String, Item>>,
}
impl<T: CatalogTransport + Send + Sync + 'static> WarningFeed<T> {
    pub fn new(transport: Arc<T>, clock: Arc<dyn Clock>) -> Self {
        Self {
            transport,
            clock,
            tail: Mutex::new(()),
            cache: Mutex::new(HashMap::new()),
        }
    }
    async fn bounded<F, R>(&self, f: F) -> Result<R, Error>
    where
        F: std::future::Future<Output = Result<R, Error>>,
    {
        tokio::time::timeout(Duration::from_secs(4), f)
            .await
            .unwrap_or(Err(Error::Timeout))
    }
    async fn head(&self) -> Result<(Head, WriteCondition), Error> {
        match self
            .bounded(self.transport.get_control(HEAD, MAX_OBJECT))
            .await
        {
            Ok(o) => Ok((parse_head(&o.body)?, WriteCondition::Match(o.etag))),
            Err(Error::NotFound) => Ok((Head::default(), WriteCondition::Absent)),
            Err(e) => Err(e),
        }
    }
    async fn item(&self, id: &str) -> Result<Item, Error> {
        if !valid_id(id) {
            return Err(Error::Corrupt("warning event reference"));
        }
        let key = format!("{PREFIX}/events/{id}.json");
        let o = self
            .bounded(self.transport.get_control(&key, MAX_OBJECT))
            .await?;
        let item: Item =
            serde_json::from_slice(&o.body).map_err(|_| Error::Corrupt("warning event"))?;
        item.normalized()?;
        if item.id != id {
            return Err(Error::Corrupt("warning event reference"));
        }
        Ok(item)
    }
    async fn publish_item(&self, item: &Item) -> Result<Item, Error> {
        let key = format!("{PREFIX}/events/{}.json", item.id);
        let body = serde_json::to_vec(item).expect("feed item");
        match self
            .bounded(
                self.transport
                    .put_control(&key, &body, &WriteCondition::Absent),
            )
            .await
        {
            Ok(200) => Ok(item.clone()),
            Ok(409 | 412) => self.item(&item.id).await,
            // A refused publication is not success. Unknown outcome is read back only.
            Ok(_) => Err(Error::Transport),
            Err(_) => self.item(&item.id).await,
        }
    }
    /// Serialize publication in this process and CAS across publishers. Retrying a storage
    /// conflict does not submit a push or make an invisible event visible without a head.
    pub async fn publish(&self, rows: &[Value]) -> Result<Value, Error> {
        let _guard = self.tail.lock().await;
        self.bounded(self.transport.ready()).await?;
        let events = prepare_events(rows);
        for _ in 0..3 {
            let (mut head, condition) = self.head().await?;
            let now = self.clock.now_ms().map_err(|_| Error::Invalid("clock"))?;
            let bootstrap = !head.baseline;
            let mut seen: HashSet<String> = head.seen.iter().cloned().collect();
            for event in &events {
                let id = event_id(event);
                if !seen.insert(id.clone()) {
                    continue;
                }
                head.seen.push(id.clone());
                if !bootstrap {
                    let event = event_value(event);
                    let source_at = published_at(&event["tmFc"]);
                    let item = Item {
                        id: id.clone(),
                        event,
                        observed_at: now,
                        source_at,
                        notify: source_at.is_some_and(|at| at <= now + 60_000 && now - at < WINDOW),
                    };
                    let saved = self.publish_item(&item).await?;
                    head.events.push(Reference {
                        id,
                        at: saved.observed_at,
                    });
                }
            }
            head.events.retain(|r| now - r.at < DAY);
            if head.seen.len() > 50_000 {
                head.seen.drain(..head.seen.len() - 50_000);
            }
            head.baseline = true;
            head.updated_at = now;
            let body = serde_json::to_vec(&head).expect("feed head");
            if body.len() > MAX_OBJECT {
                return Err(Error::Invalid("warning feed head limit"));
            }
            match self
                .bounded(self.transport.put_control(HEAD, &body, &condition))
                .await
            {
                Ok(200) => {
                    return serde_json::from_slice(&body)
                        .map_err(|_| Error::Corrupt("warning feed head"));
                }
                Ok(409 | 412) => continue,
                Ok(_) => return Err(Error::Transport),
                Err(e) => {
                    let observed = self
                        .bounded(self.transport.get_control(HEAD, MAX_OBJECT))
                        .await;
                    if observed.is_ok_and(|o| o.body == body) {
                        return serde_json::from_slice(&body)
                            .map_err(|_| Error::Corrupt("warning feed head"));
                    }
                    return Err(e);
                }
            }
        }
        Err(Error::Transport)
    }
    pub async fn items(&self) -> Result<Vec<Item>, Error> {
        let (head, _) = self.head().await?;
        let mut cache = self.cache.lock().await;
        let retained: HashSet<&str> = head.events.iter().map(|r| r.id.as_str()).collect();
        cache.retain(|id, _| retained.contains(id.as_str()));
        let missing = head
            .events
            .iter()
            .filter(|r| !cache.contains_key(&r.id))
            .collect::<Vec<_>>();
        // Immutable events have legacy's bounded in-memory cache; cache loss re-reads S3.
        for chunk in missing.chunks(8) {
            let tasks = chunk.iter().map(|r| self.item(&r.id)).collect();
            for result in super::alarm::futures_join(tasks).await {
                let item = result?;
                cache.insert(item.id.clone(), item);
            }
        }
        Ok(head.events.iter().map(|r| cache[&r.id].clone()).collect())
    }
    pub async fn read(&self) -> Result<Vec<Value>, Error> {
        self.items()
            .await?
            .iter()
            .map(|item| serde_json::to_value(item).map_err(|_| Error::Corrupt("warning event")))
            .collect()
    }
}
impl<T: CatalogTransport + Send + Sync + 'static> crate::warnings::collector::PersistedWarningFeed
    for WarningFeed<T>
{
    fn publish<'a>(
        &'a self,
        rows: &'a [Value],
    ) -> crate::gateway::BoxFuture<'a, Result<(), Error>> {
        Box::pin(async move { WarningFeed::publish(self, rows).await.map(|_| ()) })
    }
}
