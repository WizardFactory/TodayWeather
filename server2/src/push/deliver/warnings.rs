//! S18b-3 one-shot severe-warning worker. Legacy feed/selection/message contract, without
//! restart delivery recovery or automatic send retries. This library has no startup wiring.
pub use super::warning_admission::FanoutSnapshot;
use super::{
    Delivery, Diagnostics, Event as Diagnostic, Fcm, Fetch, Product, SendOutcome, Servers,
    alarm::{CONCURRENCY, futures_join},
    ledger::{Claim, Ledger, minute_path},
    text::Message,
    warning_admission::{
        Counters as FanoutCounters, MEMO_CAPACITY, PassView, TerminalMemo, join_bounded,
    },
    warning_feed::{Item, WarningFeed, event_value, group_id, published_at},
};
use crate::{
    budget::Clock,
    gateway::{BoxFuture, OrderedJson},
    push::{
        js::{ge, le, to_string},
        service::{InternalOp, PushService},
        store::{Coll, Record, oid_hex},
    },
    storage::{CatalogTransport, Error, sha256},
    warnings::{
        WarningStore,
        zones::{Event, Town, ZoneState, ZoneTable, level_of, weather_of},
    },
    world::js::{Obj, Val},
};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::{
    sync::{Mutex, Semaphore},
    time::Instant,
};
const WINDOW: i64 = 300_000;

#[derive(Clone, Debug)]
pub struct Group {
    pub id: String,
    pub event: Event,
    pub zones: Vec<String>,
    pub observed_at: i64,
}
/// Source rows are sorted exactly like engine.pollWarnings. Releases and stale items are
/// not campaigns; the current S12 zone state remains the authority at admission.
pub fn groups(items: &[Item], now: i64) -> Result<Vec<Group>, Error> {
    let mut rows = items
        .iter()
        .map(|item| Ok((item, item.normalized()?)))
        .collect::<Result<Vec<_>, Error>>()?;
    rows.sort_by(|(_, a), (_, b)| {
        crate::warnings::js::order(crate::warnings::js::chain(&[
            a.tm_fc - b.tm_fc,
            a.tm_seq - b.tm_seq,
            a.rank - b.rank,
        ]))
    });
    let mut out: Vec<Group> = Vec::new();
    for (item, e) in rows {
        if !["1", "3", "6", "7"].contains(&e.command.as_str())
            || !item.notify
            || now - item.observed_at >= WINDOW
            || item.source_at.is_none_or(|at| now - at >= WINDOW)
        {
            continue;
        }
        let id = group_id(&e);
        if let Some(g) = out.iter_mut().find(|g| g.id == id) {
            g.zones.push(e.area_code.clone())
        } else {
            out.push(Group {
                id,
                event: e.clone(),
                zones: vec![e.area_code],
                observed_at: item.observed_at,
            })
        }
    }
    Ok(out)
}
pub fn inside(info: &Obj, now: i64) -> bool {
    let t = Val::Num((now.rem_euclid(86_400_000) / 1000) as f64);
    let start = info.get("startTime");
    let end = info.get("endTime");
    if le(start, end) {
        ge(&t, start) && le(&t, end)
    } else {
        ge(&t, start) || le(&t, end)
    }
}
pub fn active(group: &Group, zone_ids: &[String], zones: &ZoneState, now: i64) -> bool {
    let end = if group.event.end_time != 0. {
        group.event.end_time
    } else {
        group.event.all_end_time
    };
    if published_at(&serde_json::json!(end)).is_some_and(|at| now >= at) {
        return false;
    }
    group.zones.iter().any(|id| {
        zone_ids.contains(id)
            && zones.entries().any(|s| {
                s.area_code == *id
                    && s.warn_var == group.event.warn_var
                    && s.active
                    && s.event_tm_fc == group.event.tm_fc
                    && s.event_tm_seq == group.event.tm_seq
                    && s.warn_stress == group.event.warn_stress
            })
    })
}
pub fn message(group: &Group, zone_ids: &[String], lang: &Val, now: i64) -> Message {
    let e = &group.event;
    let (_, weather) = weather_of(e.warn_var);
    let (_, level) = level_of(e.warn_stress);
    let area = group
        .zones
        .iter()
        .find(|z| zone_ids.contains(z))
        .map(String::as_str)
        .unwrap_or(&e.area_code);
    let name = ZoneTable::shared(now)
        .zone_name(area)
        .filter(|s| !s.is_empty())
        .unwrap_or(&e.area_name);
    let title = if *lang == Val::Str("ko".into()) {
        format!("{weather} {level}")
    } else {
        let english = match e.warn_var as i32 {
            1 => "Strong wind",
            2 => "Heavy rain",
            3 => "Cold wave",
            4 => "Dry weather",
            5 => "Storm surge",
            6 => "High waves",
            7 => "Typhoon",
            8 => "Heavy snow",
            9 => "Asian dust",
            12 => "Extreme heat",
            13 => "Tropical night",
            _ => "Severe weather",
        };
        format!(
            "{english} {}",
            if e.warn_stress == 0. {
                "advisory"
            } else {
                "warning"
            }
        )
    };
    Message {
        title: Val::Str(title),
        text: Val::Str(name.into()),
    }
}
/// Legacy urgent warning envelope; unlike ordinary alarm messages it carries eventId and
/// a five-minute FCM/APNs expiry. No real send occurs in this pure builder.
pub fn payload(notification: &Message, info: &Obj, event_id: &str, now: i64) -> Vec<u8> {
    let mut text = Obj::new();
    text.set("title", to_string(&notification.title));
    text.set("body", to_string(&notification.text));
    let mut data = Obj::new();
    data.set("cityIndex", to_string(info.get("cityIndex")));
    data.set("eventId", event_id);
    let mut android = Obj::new();
    android.set("ttl", "300s");
    android.set("priority", "HIGH");
    let mut headers = Obj::new();
    headers.set("apns-expiration", (now.div_euclid(1000) + 300).to_string());
    let mut apns = Obj::new();
    apns.set("headers", Val::Obj(headers));
    let mut m = Obj::new();
    m.set("notification", Val::Obj(text));
    m.set("data", Val::Obj(data));
    m.set("token", info.get("fcmToken").clone());
    m.set("android", Val::Obj(android));
    m.set("apns", Val::Obj(apns));
    let mut root = Obj::new();
    root.set("message", Val::Obj(m));
    Val::Obj(root).to_json()
}
pub trait CurrentZones: Send + Sync {
    fn current(&self, now: i64) -> BoxFuture<'_, Result<ZoneState, Error>>;
}
impl<T: CatalogTransport + Send + Sync + 'static> CurrentZones for WarningStore<T> {
    fn current(&self, now: i64) -> BoxFuture<'_, Result<ZoneState, Error>> {
        Box::pin(self.zone_state(now, Instant::now() + Duration::from_secs(4)))
    }
}
pub trait Locations: Send + Sync {
    fn zones<'a>(
        &'a self,
        info: &'a Obj,
        now: i64,
    ) -> BoxFuture<'a, Result<Vec<String>, &'static str>>;
}
/// Runtime adapter points at native server2 geocoding at cutover. Geocode owns shared
/// acquisitions/budgets; no caller coordinate, URL or body is used as an error message.
pub struct ApiLocations {
    fetch: Arc<dyn Fetch>,
    servers: Servers,
}
impl ApiLocations {
    pub fn new(fetch: Arc<dyn Fetch>, servers: Servers) -> Self {
        Self { fetch, servers }
    }
}
impl Locations for ApiLocations {
    fn zones<'a>(
        &'a self,
        info: &'a Obj,
        now: i64,
    ) -> BoxFuture<'a, Result<Vec<String>, &'static str>> {
        Box::pin(async move {
            let mut town = info.get("town").clone();
            if let Val::Arr(geo) = info.get("geo") {
                if geo.len() != 2
                    || geo
                        .iter()
                        .any(|v| !matches!(v,Val::Num(n) if n.is_finite()))
                {
                    return Err("invalid-location");
                }
                let url = format!(
                    "{}/geocode/v000903/coord/{},{}",
                    self.servers.api,
                    to_string(&geo[1]),
                    to_string(&geo[0])
                );
                let result =
                    tokio::time::timeout(Duration::from_secs(5), self.fetch.get(url, None))
                        .await
                        .map_err(|_| "region-timeout")?
                        .map_err(|_| "region-request")?;
                if result.0 >= 400 {
                    return Err("region-status");
                }
                let json = OrderedJson::parse(&result.1).map_err(|_| "region-response")?;
                let value = Val::from_ordered(&json);
                let Val::Obj(o) = value else {
                    return Err("region-response");
                };
                let Val::Obj(address) = o.get("kmaAddress") else {
                    return Ok(Vec::new());
                };
                let mut t = Obj::new();
                for (key, name) in [("first", "name1"), ("second", "name2"), ("third", "name3")] {
                    t.set(key, address.get(name).clone());
                }
                town = Val::Obj(t);
            }
            let Val::Obj(town) = town else {
                return Ok(Vec::new());
            };
            let town = Town {
                first: to_string(town.get("first")),
                second: to_string(town.get("second")),
                third: to_string(town.get("third")),
            };
            Ok(ZoneTable::shared(now).zones_for_town(&town))
        })
    }
}
#[derive(Default)]
struct WorkerState {
    initialized: bool,
    seen: HashSet<String>,
    open: Vec<Group>,
    regions: HashMap<Vec<u8>, Vec<String>>,
}
#[derive(Clone, Debug, Default)]
pub struct PollReport {
    pub selected: usize,
    pub attempted: usize,
    pub accepted: usize,
    pub skipped: usize,
    pub failed: usize,
}
pub struct WarningWorker<T> {
    push: Arc<PushService>,
    feed: Arc<WarningFeed<T>>,
    ledger: Ledger<T>,
    zones: Arc<dyn CurrentZones>,
    locations: Arc<dyn Locations>,
    fcm: Arc<Fcm>,
    clock: Arc<dyn Clock>,
    diagnostics: Arc<dyn Diagnostics>,
    state: Mutex<WorkerState>,
    terminal: std::sync::Mutex<TerminalMemo>,
    fanout: Arc<FanoutCounters>,
}
impl<T: CatalogTransport + Send + Sync + 'static> WarningWorker<T> {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        push: Arc<PushService>,
        transport: Arc<T>,
        feed: Arc<WarningFeed<T>>,
        zones: Arc<dyn CurrentZones>,
        locations: Arc<dyn Locations>,
        fcm: Arc<Fcm>,
        clock: Arc<dyn Clock>,
        diagnostics: Arc<dyn Diagnostics>,
    ) -> Self {
        Self {
            push,
            feed,
            ledger: Ledger::new(transport, Duration::from_secs(4)),
            zones,
            locations,
            fcm,
            clock,
            diagnostics,
            state: Mutex::new(WorkerState::default()),
            terminal: std::sync::Mutex::new(TerminalMemo::default()),
            fanout: Arc::new(FanoutCounters::default()),
        }
    }
    /// Local counters only; existing HTTP metrics wiring is unchanged. Key bytes
    /// exclude allocator/container overhead and are not a process RSS bound.
    pub fn fanout_stats(&self) -> FanoutSnapshot {
        self.fanout
            .snapshot(&self.terminal.lock().unwrap_or_else(|e| e.into_inner()))
    }
    fn current(&self, n: u64, record: &Record) -> bool {
        if !self.push.ready() {
            return false;
        }
        match self
            .push
            .state()
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .coll(Coll::Alert)
            .get(n)
        {
            Ok(value) => value.is_some_and(|r| r.oid == record.oid && r.doc == record.doc),
            Err(_) => {
                self.push.invalidate_state();
                false
            }
        }
    }
    async fn submit(
        &self,
        n: u64,
        record: &Record,
        group: &Group,
        ids: &[String],
        now: i64,
        view: &PassView,
    ) -> Delivery {
        let info = &record.doc;
        let Val::Str(token) = info.get("fcmToken") else {
            return Delivery::Failed {
                class: "invalid-token",
            };
        };
        match self
            .fcm
            .send_guarded(Product::of(info.get("package")), now, || async {
                tokio::time::timeout(Duration::from_secs(4), async {
                    let at = self.clock.now_ms().ok()?;
                    let zones = view
                        .fresh(self.zones.as_ref(), at, &self.fanout)
                        .await
                        .ok()?;
                    // Runs through the writer's journal catch-up, rather than only this
                    // process's RAM snapshot. An unavailable journal fails closed.
                    if !self
                        .push
                        .internal(InternalOp::CheckAlertSelection {
                            n,
                            oid: record.oid,
                            selected: info.clone(),
                        })
                        .await
                    {
                        return None;
                    }
                    let at = self.clock.now_ms().ok()?;
                    if at - group.observed_at >= WINDOW
                        || !inside(info, at)
                        || !active(group, ids, &zones, at)
                    {
                        return None;
                    }
                    let text = message(group, ids, info.get("lang"), at);
                    Some(payload(&text, info, &group.id, at))
                })
                .await
                .ok()
                .flatten()
            })
            .await
        {
            SendOutcome::Accepted => Delivery::Accepted,
            SendOutcome::Unregistered { status } => Delivery::Unregistered {
                status,
                disabled: self
                    .push
                    .internal(InternalOp::DisableAlertsByFcm {
                        token: token.clone(),
                    })
                    .await,
            },
            SendOutcome::Rejected { status, code } => Delivery::Rejected { status, code },
            SendOutcome::Unknown { reason } => Delivery::Unknown { reason },
            SendOutcome::NotSent { reason } => Delivery::Failed {
                class: match reason {
                    "credentials" => "fcm-credentials",
                    "oauth" => "fcm-oauth",
                    "guard" => "warning-admission",
                    "shutdown" => "shutdown-before-post",
                    _ => "fcm-connect",
                },
            },
        }
    }
    pub async fn poll(&self) -> Result<PollReport, Error> {
        crate::observability::delivery_cycle_result(
            crate::observability::DeliveryKind::Warning,
            async {
                let mut state = self.state.lock().await;
                let now = self.clock.now_ms().map_err(|_| Error::Invalid("clock"))?;
                if !self.push.ready() {
                    return Err(Error::Invalid("push state not ready"));
                }
                let items = self.feed.items().await?;
                let retained: HashSet<String> = items.iter().map(|i| i.id.clone()).collect();
                if !state.initialized {
                    state.seen = retained;
                    state.initialized = true;
                    return Ok(PollReport::default());
                }
                state.seen.retain(|id| retained.contains(id));
                let new = items
                    .iter()
                    .filter(|i| !state.seen.contains(&i.id))
                    .cloned()
                    .collect::<Vec<_>>();
                for group in groups(&new, now)? {
                    if let Some(open) = state.open.iter_mut().find(|g| g.id == group.id) {
                        for z in group.zones {
                            if !open.zones.contains(&z) {
                                open.zones.push(z)
                            }
                        }
                    } else {
                        state.open.push(group)
                    }
                }
                state.seen.extend(new.iter().map(|i| i.id.clone()));
                state.open.retain(|g| now - g.observed_at < WINDOW);
                self.terminal
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .retain(state.open.iter().map(|g| g.id.clone()));
                if state.open.is_empty() {
                    state.regions.clear();
                    return Ok(PollReport::default());
                }
                let records = self
                    .push
                    .state()
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .coll(Coll::Alert)
                    .iter()
                    .filter_map(|entry| match entry {
                        Ok((n, record))
                            if !matches!(record.doc.get("enable"), Val::Bool(false))
                                && inside(&record.doc, now) =>
                        {
                            Some(Ok((n, record)))
                        }
                        Ok(_) => None,
                        Err(error) => Some(Err(error)),
                    })
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|_| {
                        self.push.invalidate_state();
                        Error::Corrupt("push registration state")
                    })?;
                let gate = Arc::new(Semaphore::new(CONCURRENCY));
                let mut locations: BTreeMap<Vec<u8>, Vec<(u64, Record)>> = BTreeMap::new();
                for (n, r) in records {
                    let key = if matches!(r.doc.get("geo"), Val::Arr(_)) {
                        Val::Arr(vec![Val::Str("geo".into()), r.doc.get("geo").clone()]).to_json()
                    } else {
                        Val::Arr(vec![Val::Str("town".into()), r.doc.get("town").clone()]).to_json()
                    };
                    locations.entry(key).or_default().push((n, r));
                }
                state.regions.retain(|key, _| locations.contains_key(key));
                let mut resolved = Vec::new();
                let mut resolve = Vec::new();
                for (key, records) in locations {
                    if let Some(ids) = state.regions.get(&key) {
                        for (n, r) in records {
                            resolved.push((n, r, Ok(ids.clone())));
                        }
                    } else {
                        let gate = gate.clone();
                        resolve.push(async move {
                            let _p = gate.acquire_owned().await.expect("open gate");
                            let zones = self.locations.zones(&records[0].1.doc, now).await;
                            (key, records, zones)
                        });
                    }
                }
                for (key, records, ids) in futures_join(resolve).await {
                    if let Ok(ids) = &ids {
                        state.regions.insert(key, ids.clone());
                    }
                    for (n, r) in records {
                        resolved.push((n, r, ids.clone()));
                    }
                }
                resolved.sort_by_key(|(n, _, _)| *n);
                let mut report = PollReport::default();
                let view = Arc::new(PassView::default());
                let saturated = AtomicBool::new(false);
                for group in &state.open {
                    let source = published_at(&event_value(&group.event)["tmFc"]);
                    let mut endpoints = HashSet::new();
                    let mut jobs = Vec::new();
                    // Match the first registration in zone iteration order, then natural record order.
                    for zone in &group.zones {
                        for (n, record, ids) in &resolved {
                            let Ok(ids) = ids else { continue };
                            if !ids.contains(zone) {
                                continue;
                            }
                            let Val::Str(token) = record.doc.get("fcmToken") else {
                                continue;
                            };
                            if token.is_empty() {
                                continue;
                            }
                            let package =
                                if Product::of(record.doc.get("package")) == Product::TodayAir {
                                    "todayAir"
                                } else {
                                    "todayWeather"
                                };
                            let endpoint = sha256(
                                &Val::Arr(vec![Val::Str(package.into()), Val::Str(token.clone())])
                                    .to_json(),
                            );
                            if !endpoints.insert(endpoint.clone()) {
                                continue;
                            }
                            report.selected += 1;
                            // Build the ledger identity once and carry the same physical
                            // key from memo lookup to insertion after a definite claim.
                            let identity = source.map(|source| {
                                let kind = format!("warning/{}/{}", group.id, endpoint);
                                let key = format!("{}.json", minute_path(&kind, source));
                                (kind, source, key)
                            });
                            if let Some((_, _, key)) = &identity
                                && self
                                    .terminal
                                    .lock()
                                    .unwrap_or_else(|e| e.into_inner())
                                    .known(&group.id, key)
                            {
                                report.skipped += 1;
                                self.fanout.known_terminal.fetch_add(1, Ordering::Relaxed);
                                continue;
                            }
                            jobs.push((*n, record.clone(), ids.clone(), identity));
                        }
                    }
                    let tasks = jobs.into_iter().map(|(n, record, ids, identity)| {
                        let gate = gate.clone();
                        let view = &view;
                        let saturated = &saturated;
                        crate::observability::value(
                            crate::observability::Component::Delivery,
                            crate::observability::Stage::Submission,
                            async move {
                                let _live = self.fanout.job();
                                let _permit = gate.acquire_owned().await.expect("open gate");
                                let now =
                                    self.clock.now_ms().map_err(|_| Error::Invalid("clock"))?;
                                if now - group.observed_at >= WINDOW
                                    || !self.current(n, &record)
                                    || !inside(&record.doc, now)
                                {
                                    return Ok(None);
                                }
                                let zones =
                                    view.current(self.zones.as_ref(), now, &self.fanout).await?;
                                if !active(group, &ids, &zones, now) {
                                    return Ok(None);
                                }
                                let (kind, source, key) =
                                    identity.ok_or(Error::Corrupt("warning source time"))?;
                                let claimed = self
                                    .ledger
                                    .claim(&kind, source, now, &[oid_hex(&record.oid)])
                                    .await;
                                if matches!(claimed, Claim::Owned | Claim::Taken) {
                                    let remembered = self
                                        .terminal
                                        .lock()
                                        .unwrap_or_else(|e| e.into_inner())
                                        .record(&group.id, key, MEMO_CAPACITY);
                                    if !remembered {
                                        self.fanout.saturated.fetch_add(1, Ordering::Relaxed);
                                        if !saturated.swap(true, Ordering::Relaxed) {
                                            self.diagnostics.minute(
                                                &crate::world::js::iso(now as f64)
                                                    .unwrap_or_default(),
                                                "warning-terminal-memo-saturated",
                                            );
                                        }
                                    }
                                }
                                if claimed != Claim::Owned {
                                    return Ok(None);
                                }
                                let now =
                                    self.clock.now_ms().map_err(|_| Error::Invalid("clock"))?;
                                // Claims are never released, including cancellation or a concurrent edit.
                                let result = if !self.current(n, &record)
                                    || !inside(&record.doc, now)
                                    || now - group.observed_at >= WINDOW
                                {
                                    Delivery::Failed {
                                        class: "registration-changed-or-expired",
                                    }
                                } else {
                                    match view.fresh(self.zones.as_ref(), now, &self.fanout).await {
                                        Err(_) => Delivery::Failed {
                                            class: "warning-state",
                                        },
                                        Ok(zones) if !active(group, &ids, &zones, now) => {
                                            Delivery::Failed {
                                                class: "warning-inactive",
                                            }
                                        }
                                        Ok(_) => {
                                            self.submit(n, &record, group, &ids, now, view).await
                                        }
                                    }
                                };
                                let id = oid_hex(&record.oid);
                                let at = crate::world::js::iso(now as f64).unwrap_or_default();
                                self.diagnostics.delivery(&Diagnostic {
                                    kind: "warning",
                                    minute: at,
                                    id: id.clone(),
                                    outcome: result.outcome(),
                                    class: result.class(),
                                    status: result.status(),
                                });
                                let value = serde_json::json!({"schema":1,"kind":"warning",
                        "event":group.id,"record":id,"outcome":result.outcome(),
                        "class":result.class(),"status":result.status()});
                                let _ = self.ledger.result(&kind, source, &value).await;
                                Ok::<_, Error>(Some(result))
                            },
                            |result| match result {
                                Ok(Some(delivery)) => crate::observability::delivery(delivery),
                                Ok(None) => crate::observability::skipped(),
                                Err(error) => crate::observability::error(error),
                            },
                        )
                    });
                    for result in join_bounded(tasks).await {
                        match result {
                            Ok(Some(Delivery::Accepted)) => {
                                report.attempted += 1;
                                report.accepted += 1
                            }
                            Ok(Some(_)) => {
                                report.attempted += 1;
                                report.failed += 1
                            }
                            Ok(None) => report.skipped += 1,
                            Err(_) => report.failed += 1,
                        }
                    }
                }
                Ok(report)
            },
        )
        .await
    }
    /// Readiness does not start this loop; S20 installs one owner. Every startup's first poll
    /// is silent. An errored/cancelled pass cannot release a durable delivery claim.
    pub async fn run(self: Arc<Self>) {
        loop {
            if self.poll().await.is_err() {
                self.diagnostics.minute(
                    "warning-feed",
                    "warning poll unavailable; no unsafe submission",
                );
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    }
}
