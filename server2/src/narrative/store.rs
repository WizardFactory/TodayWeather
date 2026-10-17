use super::{
    Acquire, DAY_MS, Narrative, OFFICES, Read, announcement, now_ms,
    provider::{Page, Source},
    select,
};
use crate::{
    gateway::BoxFuture,
    history::IndexListing,
    storage::{
        Catalog, CatalogId, CatalogLimits, CatalogStore, Error, Limits, PageOutcome, Period,
        ProviderKey, RawRecord, sha256,
    },
};
use std::{collections::BTreeSet, sync::Arc, time::Duration};
use tokio::{sync::Mutex, time::Instant};

pub const SOURCE: &str = "kma-forecast-narrative";
pub const KIND: &str = "overview";
const MAX_PAGE_BYTES: usize = 2 << 20; // Same bound as the native data.go.kr transport.
fn key(station: u16) -> ProviderKey {
    ProviderKey::Named {
        id: station.to_string(),
    }
}
fn identity(station: u16, tm: &str) -> Result<CatalogId, Error> {
    let id = CatalogId {
        source: SOURCE.into(),
        kind: KIND.into(),
        key_sha256: sha256(&key(station).canonical_bytes()?),
        partition: tm.into(),
    };
    id.validate()?;
    Ok(id)
}
/// Raw response bytes are immutable; the catalog winner binds their selected publication.
pub struct Store<T> {
    transport: T,
    catalog: CatalogStore<T>,
}
impl<T: IndexListing + Clone> Store<T> {
    pub fn new(transport: T) -> Result<Self, Error> {
        Ok(Self {
            catalog: CatalogStore::new(transport.clone(), CatalogLimits::default())?,
            transport,
        })
    }
    pub async fn publish(
        &self,
        station: u16,
        page: Page,
        deadline: Instant,
    ) -> Result<Option<Narrative>, Error> {
        if page.body.len() > MAX_PAGE_BYTES {
            return Err(Error::Capacity);
        }
        let fetched =
            i64::try_from(page.fetched_at_ms).map_err(|_| Error::Invalid("narrative clock"))?;
        let rows = crate::warnings::provider::items(&page.body)
            .map_err(|_| Error::Invalid("narrative page"))?;
        let Some(rows) = rows else { return Ok(None) };
        let Some((tm, _)) =
            select(station, &rows, fetched).map_err(|_| Error::Invalid("narrative rows"))?
        else {
            return Ok(None);
        };
        let record = RawRecord::new(
            SOURCE,
            KIND,
            &key(station),
            Period {
                local_date: tm[..8].parse().map_err(|_| Error::Invalid("date"))?,
                slot: tm[8..].into(),
            },
            page.fetched_at_ms,
            200,
            &page.content_type,
            None,
            page.body,
            &Limits::default(),
        )?;
        let winner = self
            .catalog
            .publish_once(identity(station, &tm)?, record, deadline)
            .await?;
        decode(station, &tm, &winner, now_ms()).map(Some)
    }
    pub async fn read(
        &self,
        station: u16,
        now: i64,
        deadline: Instant,
    ) -> Result<Option<Narrative>, Error> {
        if !OFFICES.iter().any(|o| o.0 == station) {
            return Ok(None);
        }
        tokio::time::timeout_at(deadline, async {
            let id = identity(station, "placeholder")?;
            let mut publications = BTreeSet::new();
            for offset in [0, -1] {
                let date = crate::warnings::provider::kst_date(now, offset);
                let prefix = format!("index/v2/{SOURCE}/{KIND}/{}/{date}", id.key_sha256);
                let mut token = None;
                let mut seen = BTreeSet::new();
                for page in 0..8 {
                    let list = self.transport.list_index(&prefix, token.as_deref()).await?;
                    if list.keys.len() > 1000 {
                        return Err(Error::Capacity);
                    }
                    for path in list.keys {
                        let tm = path
                            .strip_prefix(&format!("index/v2/{SOURCE}/{KIND}/{}/", id.key_sha256))
                            .and_then(|p| p.strip_suffix(".json"))
                            .ok_or(Error::Corrupt("narrative index namespace"))?;
                        let at = announcement(tm)
                            .ok_or(Error::Corrupt("narrative index publication"))?;
                        if now >= at && now - at < DAY_MS {
                            publications.insert(tm.to_owned());
                        }
                        if publications.len() > 1000 {
                            return Err(Error::Capacity);
                        }
                    }
                    match list.next {
                        None => break,
                        Some(next) if page < 7 && seen.insert(next.clone()) => token = Some(next),
                        Some(_) => return Err(Error::Capacity),
                    }
                }
            }
            let Some(tm) = publications.last() else {
                return Ok(None);
            };
            let id = identity(station, tm)?;
            let object = self
                .transport
                .get_control(&id.key(), CatalogLimits::default().control_bytes)
                .await?;
            let catalog = Catalog::from_bytes(&object.body, &id, &CatalogLimits::default())?;
            if catalog.entries.len() != 1 {
                return Err(Error::Corrupt("narrative catalog cardinality"));
            }
            let entry = &catalog.entries[0];
            if entry.raw_length > MAX_PAGE_BYTES {
                return Err(Error::Capacity);
            }
            if entry.fetch_group.is_some() || entry.pagination.is_some() {
                return Err(Error::Corrupt("narrative group"));
            }
            let PageOutcome::Ready(page) = self
                .catalog
                .lookup_acquisition(&id, &entry.identity, deadline)
                .await?
            else {
                return Err(Error::Corrupt("narrative incomplete"));
            };
            let records = page
                .acquisitions()
                .iter()
                .flat_map(|a| a.records())
                .collect::<Vec<_>>();
            if records.len() != 1 {
                return Err(Error::Corrupt("narrative raw cardinality"));
            }
            decode(station, tm, records[0], now).map(Some)
        })
        .await
        .map_err(|_| Error::Timeout)?
    }
}
fn decode(station: u16, tm: &str, raw: &RawRecord, now: i64) -> Result<Narrative, Error> {
    let rows = crate::warnings::provider::items(&raw.bytes)
        .map_err(|_| Error::Corrupt("narrative page"))?
        .ok_or(Error::Corrupt("narrative noData"))?;
    let fetched = i64::try_from(raw.envelope.identity.fetched_at_ms)
        .map_err(|_| Error::Corrupt("narrative clock"))?;
    let (selected, n) = select(station, &rows, fetched)
        .map_err(|_| Error::Corrupt("narrative rows"))?
        .ok_or(Error::Corrupt("narrative empty"))?;
    if selected != tm
        || !n.fresh(now)
        || raw.envelope.identity.period.local_date.to_string() != tm[..8]
        || raw.envelope.identity.period.slot != tm[8..]
    {
        return Err(Error::Corrupt("narrative publication identity/expiry"));
    }
    Ok(n)
}
type Cache = Mutex<Option<(Instant, Option<Narrative>)>>;
pub struct Service<T> {
    store: Store<T>,
    source: Arc<dyn Source>,
    cycle: Mutex<()>,
    cache: [Cache; 10],
}
impl<T: IndexListing + Clone> Service<T> {
    pub fn new(transport: T, source: Arc<dyn Source>) -> Result<Self, Error> {
        Ok(Self {
            store: Store::new(transport)?,
            source,
            cycle: Mutex::new(()),
            cache: std::array::from_fn(|_| Mutex::new(None)),
        })
    }
}
impl<T: IndexListing + Clone + 'static> Read for Service<T> {
    fn read(&self, station: u16, deadline: Instant) -> BoxFuture<'_, Option<Narrative>> {
        Box::pin(async move {
            let i = OFFICES.iter().position(|o| o.0 == station)?;
            let mut cache = tokio::time::timeout_at(deadline, self.cache[i].lock())
                .await
                .ok()?;
            let now = now_ms();
            if let Some((until, value)) = cache.as_ref()
                && Instant::now() < *until
            {
                return value.as_ref().filter(|n| n.fresh(now)).cloned();
            }
            let value = crate::observability::observe(
                crate::observability::Component::Domestic,
                crate::observability::Stage::Lookup,
                self.store.read(station, now, deadline),
            )
            .await
            .ok()
            .flatten();
            *cache = Some((Instant::now() + Duration::from_secs(30), value.clone()));
            value
        })
    }
}
impl<T: IndexListing + Clone + 'static> Acquire for Service<T> {
    fn refresh(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            let Ok(_cycle) = self.cycle.try_lock() else {
                return;
            };
            for (i, (station, _, _)) in OFFICES.iter().enumerate() {
                let deadline = Instant::now() + Duration::from_secs(30);
                let fetched = crate::observability::observe(
                    crate::observability::Component::Provider,
                    crate::observability::Stage::Acquire,
                    async {
                        tokio::time::timeout_at(deadline, self.source.fetch(*station, deadline))
                            .await
                            .map_err(|_| super::provider::Error::Deadline)?
                    },
                )
                .await;
                if let Ok(Some(page)) = fetched
                    && crate::observability::observe(
                        crate::observability::Component::Domestic,
                        crate::observability::Stage::Publish,
                        self.store
                            .publish(*station, page, Instant::now() + Duration::from_secs(3)),
                    )
                    .await
                    .is_ok()
                {
                    *self.cache[i].lock().await = None;
                }
            }
        })
    }
}
