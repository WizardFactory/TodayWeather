//! Cancellation-safe demand authority, bounded decisions and one national replay flight.
//! No timer, provider, startup read or absent-authority write is introduced.
use super::super::backend::Clock;
use super::{
    Doc, Val, grid_of,
    rainfall_input::{self, Current, Minute, MinuteResult},
    rainfall_store::{self, Checkpoint, Namespace, Receipt, SAFE, Store, digest},
    rnshit,
    seed::StationSeed,
};
use crate::{
    gateway::BoxFuture,
    storage::{CatalogLimits, CatalogStore, CatalogTransport, Error},
};
use serde_json::json;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{
    sync::{Notify, OwnedSemaphorePermit, Semaphore, watch},
    time::{Instant, timeout_at},
};

pub trait Lifecycle: Send + Sync {
    fn quiesce(&self);
    fn drain(&self, deadline: Instant) -> BoxFuture<'_, bool>;
}
#[derive(Clone)]
pub(super) struct Overlay {
    pub state: Arc<Checkpoint>,
    pub seed: Arc<StationSeed>,
    pub since: f64,
    // Kept through Source's seed-refold/application, not only until oneshot delivery.
    _delivery: Option<Arc<OwnedSemaphorePermit>>,
}
#[derive(Clone)]
struct Pinned {
    seed: Arc<StationSeed>,
    epoch: String,
    acknowledged_revision: u64,
    first_seen_at: f64,
    state: Arc<Checkpoint>,
}
type Answer = Result<Option<Overlay>, Error>;
struct Reply {
    tx: watch::Sender<Option<Answer>>,
    until: Mutex<Instant>,
}
impl Reply {
    fn new(until: Instant) -> Arc<Self> {
        Arc::new(Self {
            tx: watch::channel(None).0,
            until: Mutex::new(until),
        })
    }
    fn expired(&self) -> bool {
        Instant::now() >= *self.until.lock().unwrap_or_else(|e| e.into_inner())
    }
    fn tighten(&self, until: Instant) {
        let mut old = self.until.lock().unwrap_or_else(|e| e.into_inner());
        *old = (*old).min(until);
        drop(old);
        self.tx.send_modify(|_| {});
    }
    fn finish(&self, result: Answer) {
        self.tx.send_replace(Some(result));
    }
    async fn wait(&self, deadline: Instant) -> Answer {
        let mut rx = self.tx.subscribe();
        loop {
            let until = deadline.min(*self.until.lock().unwrap_or_else(|e| e.into_inner()));
            if Instant::now() >= until {
                return Err(Error::Timeout);
            }
            let value = rx.borrow_and_update().clone();
            if let Some(result) = value {
                return if self.expired() || Instant::now() >= deadline {
                    Err(Error::Timeout)
                } else {
                    result
                };
            }
            timeout_at(until, rx.changed())
                .await
                .map_err(|_| Error::Timeout)?
                .map_err(|_| Error::Transport)?;
        }
    }
}
struct Task(Arc<AtomicUsize>);
impl Drop for Task {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
struct Workspace {
    permit: Option<OwnedSemaphorePermit>,
    wake: Arc<Notify>,
}
impl Drop for Workspace {
    fn drop(&mut self) {
        drop(self.permit.take());
        self.wake.notify_waiters();
    }
}
struct Intent {
    id: u64,
    deadline: Instant,
    pending_input: bool,
    reply: Arc<Reply>,
}
struct Flight {
    serial: u64,
    epoch: String,
    seed: String,
    end: u64,
    until: Instant,
    workspace: Arc<Workspace>,
    cursor: Arc<Semaphore>,
    state: Mutex<FlightState>,
}
struct FlightState {
    open: bool,
    members: BTreeSet<u64>,
    projection: Option<Arc<rainfall_input::Projection>>,
}
#[derive(Default)]
struct Coordinator {
    next_intent: u64,
    next_flight: u64,
    intents: BTreeMap<([u16; 2], u64), Intent>,
    probe: Option<Arc<Reply>>,
    flight: Option<Arc<Flight>>,
}
pub struct Owner<T> {
    store: Store<T>,
    inputs: Arc<CatalogStore<T>>,
    clock: Clock,
    accepting: AtomicBool,
    offers: Arc<Semaphore>,
    running: Arc<Semaphore>,
    readers: Arc<Semaphore>,
    writer: tokio::sync::Mutex<()>,
    coord: Mutex<Coordinator>,
    wake: Arc<Notify>,
    active: Arc<AtomicUsize>,
    pinned: Mutex<Option<Pinned>>,
    versions: Mutex<Vec<Weak<Checkpoint>>>,
    cutoff: Arc<dyn Fn() -> Result<u64, Error> + Send + Sync>,
    #[cfg(test)]
    parses: AtomicUsize,
}
fn input_clock() -> Result<u64, Error> {
    u64::try_from(
        crate::budget::Clock::now_ms(&crate::budget::SystemClock)
            .map_err(|_| Error::Invalid("rainfall clock"))?,
    )
    .map_err(|_| Error::Invalid("rainfall clock"))
}
fn same_state(a: &Checkpoint, b: &Checkpoint) -> bool {
    a == b
        && a.rows.iter().zip(&b.rows).all(|(a, b)| {
            a.rns_hit.map(f64::to_bits) == b.rns_hit.map(f64::to_bits)
                && a.rns_count.map(f64::to_bits) == b.rns_count.map(f64::to_bits)
        })
}
fn candidates(seed: &StationSeed, current: &Current) -> Vec<(rainfall_store::ObjectId, f64)> {
    let mut result: Vec<_> = seed
        .docs
        .iter()
        .zip(&seed.identities)
        .filter_map(|(d, oid)| {
            let oid = (*oid)?;
            let Val::Arr(g) = d.get("geo")? else {
                return None;
            };
            let (nx, ny) = grid_of(g.get(1)?.as_num()?, g.first()?.as_num()?);
            let sensor = d
                .get("stnId")?
                .as_str()
                .map(crate::world::js::string_to_number)?;
            (nx == f64::from(current.grid[0])
                && ny == f64::from(current.grid[1])
                && sensor.is_finite())
            .then_some((oid, sensor))
        })
        .collect();
    result.sort_by_key(|(oid, _)| *oid);
    result
}
fn needed(overlay: &Overlay, current: &Current) -> bool {
    current.end >= overlay.state.activation.first_end_ms
        && (current.pty > 0. || current.rn1 > 0.)
        && candidates(&overlay.seed, current).iter().any(|(oid, _)| {
            overlay
                .state
                .rows
                .iter()
                .any(|r| r.oid == *oid && r.last_end_ms.is_none_or(|e| e < current.end))
        })
}
impl<T: CatalogTransport + Clone + Send + Sync + 'static> Owner<T> {
    pub fn new(transport: T, target: Namespace, clock: Clock) -> Result<Arc<Self>, Error> {
        Ok(Arc::new(Self {
            store: Store {
                transport: transport.clone(),
                target,
            },
            inputs: Arc::new(CatalogStore::new(transport, CatalogLimits::default())?),
            clock,
            accepting: AtomicBool::new(true),
            offers: Arc::new(Semaphore::new(8)),
            running: Arc::new(Semaphore::new(1)),
            readers: Arc::new(Semaphore::new(128)),
            writer: tokio::sync::Mutex::new(()),
            coord: Mutex::new(Coordinator::default()),
            wake: Arc::new(Notify::new()),
            active: Arc::new(AtomicUsize::new(0)),
            pinned: Mutex::new(None),
            versions: Mutex::new(Vec::new()),
            cutoff: Arc::new(input_clock),
            #[cfg(test)]
            parses: AtomicUsize::new(0),
        }))
    }
    fn task(&self) -> Task {
        self.active.fetch_add(1, Ordering::SeqCst);
        Task(self.active.clone())
    }
    pub(super) async fn offer(
        self: &Arc<Self>,
        seed: Arc<StationSeed>,
        current: Option<Current>,
        outer_deadline: Instant,
        caller_ready_by: Instant,
    ) -> Answer {
        let admitted = Instant::now();
        let deadline = admitted + Duration::from_secs(3);
        if !self.accepting.load(Ordering::SeqCst) {
            return Err(Error::Capacity);
        }
        let admission_until = outer_deadline
            .checked_sub(Duration::from_millis(10))
            .filter(|d| *d > Instant::now())
            .ok_or(Error::Timeout)?;
        let wait_until = caller_ready_by.min(admission_until);
        let ticket = Arc::new(
            self.readers
                .clone()
                .try_acquire_owned()
                .map_err(|_| Error::Capacity)?,
        );
        let mut owned = None;
        let reply = if let Some(witness) = current.as_ref().filter(|c| c.pty > 0. || c.rn1 > 0.) {
            let key = (witness.grid, witness.end);
            let mut coord = self.coord.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(intent) = coord.intents.get(&key) {
                Some(intent.reply.clone())
            } else if let Ok(permit) = self.offers.clone().try_acquire_owned() {
                let id = coord.next_intent.checked_add(1).ok_or(Error::Capacity)?;
                coord.next_intent = id;
                let reply = Reply::new(deadline);
                coord.intents.insert(
                    key,
                    Intent {
                        id,
                        deadline,
                        pending_input: true,
                        reply: reply.clone(),
                    },
                );
                if let Some(flight) = &coord.flight {
                    let mut state = flight.state.lock().unwrap_or_else(|e| e.into_inner());
                    if state.open && flight.end == witness.end && Instant::now() < flight.until {
                        state.members.insert(id);
                    }
                }
                owned = Some((key, id, permit, reply.clone(), witness.clone()));
                Some(reply)
            } else {
                None
            }
        } else {
            None
        };
        if let Some((key, id, permit, completed, witness)) = owned {
            let this = self.clone();
            let seed = seed.clone();
            let task = self.task();
            crate::observability::spawn(async move {
                let _task = task;
                let _permit = permit;
                let result = timeout_at(deadline, async {
                    if Instant::now() >= deadline {
                        return Err(Error::Timeout);
                    }
                    let cutoff = (this.cutoff)()?;
                    this.work(seed, witness, id, cutoff, deadline).await
                })
                .await
                .unwrap_or(Err(Error::Timeout));
                this.finish_intent(key, id);
                completed.finish(result);
            });
        }
        // Even an already-expired caller must create the actual owned probe before returning.
        let probe = if reply.is_none() {
            Some(self.probe(seed, deadline))
        } else {
            None
        };
        let lifetime = reply
            .clone()
            .or_else(|| probe.clone())
            .expect("owned reply lifetime");
        let operation = async {
            if let Some(reply) = reply {
                reply.wait(deadline).await
            } else {
                let result = probe
                    .expect("read-only probe registered")
                    .wait(deadline)
                    .await?;
                if let (Some(overlay), Some(witness)) = (&result, &current)
                    && needed(overlay, witness)
                {
                    return Err(Error::Capacity);
                }
                Ok(result)
            }
        };
        if Instant::now() >= wait_until {
            return Err(Error::Timeout);
        }
        let result = timeout_at(wait_until, operation).await;
        if Instant::now() >= wait_until || lifetime.expired() {
            return Err(Error::Timeout);
        }
        let mut result = result.map_err(|_| Error::Timeout)??;
        // An earlier real immutable ACK may be delivered after a later grid's ACK.
        // Only fresh authority reads/acknowledge enforce monotonic revision fences.
        let pinned = self.pinned();
        if let (None, Some(_)) = (&result, &pinned) {
            return Err(Error::Corrupt("rainfall authority disappeared"));
        }
        if let Some(overlay) = result.as_mut() {
            overlay._delivery = Some(ticket);
        }
        Ok(result)
    }
    fn pinned(&self) -> Option<Pinned> {
        self.pinned
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
    fn acknowledge(&self, state: Checkpoint, mut seed: Arc<StationSeed>) -> Result<Overlay, Error> {
        let now = (self.clock)();
        if !now.is_finite() {
            return Err(Error::Invalid("rainfall acknowledged clock"));
        }
        let mut pinned = self.pinned.lock().unwrap_or_else(|e| e.into_inner());
        let mut state = Arc::new(state);
        let since;
        if let Some(old) = pinned.as_mut() {
            if old.epoch != state.activation.epoch || old.seed.body_sha256 != seed.body_sha256 {
                return Err(Error::Corrupt("rainfall changed epoch"));
            }
            // The new bytes have already passed exact independent S06/seed binding validation.
            // Reuse the immutable pinned payload; do not retain one parsed seed per reader/probe.
            seed = old.seed.clone();
            if state.revision < old.acknowledged_revision {
                return Err(Error::Corrupt("rainfall rollback"));
            }
            if state.revision == old.acknowledged_revision {
                if !same_state(&old.state, &state) {
                    return Err(Error::Corrupt("rainfall revision equivocation"));
                }
                state = old.state.clone();
            } else {
                old.acknowledged_revision = state.revision;
                old.first_seen_at = now;
                old.state = state.clone();
            }
            since = old.first_seen_at;
        } else {
            since = now;
            *pinned = Some(Pinned {
                seed: seed.clone(),
                epoch: state.activation.epoch.clone(),
                acknowledged_revision: state.revision,
                first_seen_at: now,
                state: state.clone(),
            });
        }
        drop(pinned);
        let mut versions = self.versions.lock().unwrap_or_else(|e| e.into_inner());
        versions.retain(|w| w.strong_count() > 0);
        if let Some(shared) = versions
            .iter()
            .filter_map(Weak::upgrade)
            .find(|s| same_state(s, &state))
        {
            state = shared;
        } else {
            if versions.len() >= 9 {
                return Err(Error::Capacity);
            }
            versions.push(Arc::downgrade(&state));
        }
        Ok(Overlay {
            state,
            seed,
            since,
            _delivery: None,
        })
    }
    fn probe(self: &Arc<Self>, seed: Arc<StationSeed>, deadline: Instant) -> Arc<Reply> {
        let mut coord = self.coord.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(reply) = &coord.probe {
            return reply.clone();
        }
        let reply = Reply::new(deadline);
        coord.probe = Some(reply.clone());
        let completed = reply.clone();
        let this = self.clone();
        let task = self.task();
        crate::observability::spawn(async move {
            let _task = task;
            let result = timeout_at(deadline, async {
                if Instant::now() >= deadline {
                    return Err(Error::Timeout);
                }
                let pinned = this.pinned();
                let candidate = pinned.as_ref().map_or(seed, |p| p.seed.clone());
                match this
                    .store
                    .resolve(candidate, &this.inputs, deadline)
                    .await?
                {
                    Some((state, _, seed)) => this.acknowledge(state, seed).map(Some),
                    None if this.pinned().is_none() => Ok(None),
                    None => Err(Error::Corrupt("rainfall authority disappeared")),
                }
            })
            .await
            .unwrap_or(Err(Error::Timeout));
            {
                let mut coord = this.coord.lock().unwrap_or_else(|e| e.into_inner());
                if coord
                    .probe
                    .as_ref()
                    .is_some_and(|r| Arc::ptr_eq(r, &completed))
                {
                    coord.probe = None;
                }
            }
            completed.finish(result);
        });
        reply
    }
    fn release_member(&self, id: u64) {
        let mut coord = self.coord.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(intent) = coord.intents.values_mut().find(|i| i.id == id) {
            intent.pending_input = false;
        }
        Self::retire_member(&mut coord, id);
        self.wake.notify_waiters();
    }
    fn retire_member(coord: &mut Coordinator, id: u64) {
        let retire = if let Some(flight) = &coord.flight {
            let mut state = flight.state.lock().unwrap_or_else(|e| e.into_inner());
            state.members.remove(&id);
            if state.members.is_empty() {
                state.open = false;
                true
            } else {
                false
            }
        } else {
            false
        };
        if retire {
            coord.flight = None;
        }
    }
    fn finish_intent(&self, key: ([u16; 2], u64), id: u64) {
        let mut coord = self.coord.lock().unwrap_or_else(|e| e.into_inner());
        if coord.intents.get(&key).is_some_and(|i| i.id == id) {
            coord.intents.remove(&key);
        }
        Self::retire_member(&mut coord, id);
        self.wake.notify_waiters();
    }
    async fn flight(
        &self,
        state: &Checkpoint,
        id: u64,
        end: u64,
        deadline: Instant,
        avoid: Option<u64>,
    ) -> Result<Arc<Flight>, Error> {
        loop {
            if Instant::now() >= deadline {
                return Err(Error::Timeout);
            }
            let notified = self.wake.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                let mut coord = self.coord.lock().unwrap_or_else(|e| e.into_inner());
                if coord
                    .flight
                    .as_ref()
                    .is_some_and(|f| Instant::now() >= f.until)
                {
                    if let Some(f) = &coord.flight {
                        f.state.lock().unwrap_or_else(|e| e.into_inner()).open = false;
                    }
                    coord.flight = None;
                }
                if let Some(intent) = coord.intents.values_mut().find(|i| i.id == id) {
                    intent.pending_input = true;
                }
                if let Some(flight) = &coord.flight {
                    let mut members = flight.state.lock().unwrap_or_else(|e| e.into_inner());
                    if members.open
                        && flight.end == end
                        && flight.epoch == state.activation.epoch
                        && flight.seed == state.activation.seed_body_sha256
                        && Some(flight.serial) != avoid
                    {
                        members.members.insert(id);
                        return Ok(flight.clone());
                    }
                } else if let Ok(permit) = self.running.clone().try_acquire_owned() {
                    let serial = coord.next_flight.checked_add(1).ok_or(Error::Capacity)?;
                    coord.next_flight = serial;
                    let mut members: BTreeSet<_> = coord
                        .intents
                        .iter()
                        .filter(|((_, e), i)| *e == end && i.pending_input)
                        .map(|(_, i)| i.id)
                        .collect();
                    members.insert(id);
                    let until = coord
                        .intents
                        .iter()
                        .filter(|((_, e), i)| {
                            *e == end && i.pending_input && i.deadline > Instant::now()
                        })
                        .map(|(_, i)| i.deadline)
                        .min()
                        .unwrap_or(deadline)
                        .min(deadline);
                    let flight = Arc::new(Flight {
                        serial,
                        epoch: state.activation.epoch.clone(),
                        seed: state.activation.seed_body_sha256.clone(),
                        end,
                        until,
                        workspace: Arc::new(Workspace {
                            permit: Some(permit),
                            wake: self.wake.clone(),
                        }),
                        cursor: Arc::new(Semaphore::new(1)),
                        state: Mutex::new(FlightState {
                            open: true,
                            members,
                            projection: None,
                        }),
                    });
                    coord.flight = Some(flight.clone());
                    return Ok(flight);
                }
            }
            timeout_at(deadline, notified)
                .await
                .map_err(|_| Error::Timeout)?;
        }
    }
    async fn minutes(
        &self,
        overlay: &Overlay,
        current: &Current,
        intent: u64,
        cutoff: u64,
        deadline: Instant,
    ) -> Result<(MinuteResult, Instant), Error> {
        let mut avoid = None;
        loop {
            let flight = self
                .flight(&overlay.state, intent, current.end, deadline, avoid)
                .await?;
            let until = deadline.min(flight.until);
            let cursor = timeout_at(until, flight.cursor.clone().acquire_owned())
                .await
                .map_err(|_| Error::Timeout)?
                .map_err(|_| Error::Capacity)?;
            if Instant::now() >= until {
                return Err(Error::Timeout);
            }
            let guard = Arc::new((flight.workspace.clone(), cursor));
            let existing = flight
                .state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .projection
                .clone();
            let mut plan = rainfall_input::validate(
                &self.store.transport,
                &self.inputs,
                current,
                cutoff,
                until,
                existing.is_none(),
            )
            .await?;
            if Instant::now() >= until {
                return Err(Error::Timeout);
            }
            let projection = if let Some(existing) = existing {
                if plan.ordered != existing.ordered {
                    avoid = Some(flight.serial);
                    self.release_member(intent);
                    drop(guard);
                    drop(flight);
                    continue;
                }
                existing
            } else {
                let mut sensors = Vec::new();
                for doc in &overlay.seed.docs {
                    if let Some(id) = doc
                        .get("stnId")
                        .and_then(Val::as_str)
                        .map(crate::world::js::string_to_number)
                        .filter(|n| n.is_finite())
                        && !sensors.contains(&id)
                    {
                        sensors.push(id);
                    }
                }
                if sensors.len() > 1024 {
                    return Err(Error::Capacity);
                }
                #[cfg(test)]
                self.parses.fetch_add(1, Ordering::SeqCst);
                let projection = Arc::new(
                    timeout_at(
                        until,
                        plan.project(sensors, until, guard.clone(), flight.workspace.clone()),
                    )
                    .await
                    .map_err(|_| Error::Timeout)?
                    .map_err(|_| Error::Corrupt("rainfall parse task"))??,
                );
                if Instant::now() >= until {
                    return Err(Error::Timeout);
                }
                flight
                    .state
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .projection = Some(projection.clone());
                projection
            };
            let result = timeout_at(until, plan.materialize(projection, until, guard.clone()))
                .await
                .map_err(|_| Error::Timeout)?
                .map_err(|_| Error::Corrupt("rainfall materialize task"))??;
            return Ok((result, flight.until));
        }
    }
    async fn read(
        &self,
        seed: &Arc<StationSeed>,
        deadline: Instant,
    ) -> Result<Option<(Checkpoint, crate::storage::ControlObject)>, Error> {
        let result = self
            .store
            .resolve(seed.clone(), &self.inputs, deadline)
            .await?;
        if let Some(pin) = self.pinned()
            && result.as_ref().is_none_or(|(s, _, _)| {
                s.activation.epoch != pin.epoch
                    || s.revision < pin.acknowledged_revision
                    || s.revision == pin.acknowledged_revision && !same_state(s, &pin.state)
            })
        {
            return Err(Error::Corrupt(
                "rainfall authority disappeared/changed/rollback",
            ));
        }
        Ok(result.map(|(s, o, _)| (s, o)))
    }
    async fn work(
        self: &Arc<Self>,
        seed: Arc<StationSeed>,
        current: Current,
        intent: u64,
        cutoff: u64,
        deadline: Instant,
    ) -> Answer {
        let Some(overlay) = self.probe(seed, deadline).wait(deadline).await? else {
            return Ok(None);
        };
        if !needed(&overlay, &current) {
            return Ok(Some(overlay));
        }
        let clock = (self.clock)();
        if !clock.is_finite()
            || clock < overlay.state.activation.shutdown_at_ms as f64
            || cutoff < overlay.state.activation.shutdown_at_ms
        {
            return Err(Error::Invalid("rainfall shutdown clock"));
        }
        let candidates = candidates(&overlay.seed, &current);
        let (minutes, use_until) = self
            .minutes(&overlay, &current, intent, cutoff, deadline)
            .await?;
        {
            let mut coord = self.coord.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(intent) = coord.intents.values_mut().find(|i| i.id == intent) {
                // Keep its OLD flight membership for unsent facts, but never auto-enrol this
                // already-validated writer into a later flight after H expires.
                intent.pending_input = false;
                intent.reply.tighten(use_until);
            }
        }
        let minutes = match minutes {
            MinuteResult::Ready(v) => v,
            MinuteResult::NotEligible => return Ok(Some(overlay)),
        };
        let seed = overlay.seed;
        let _writer = timeout_at(deadline.min(use_until), self.writer.lock())
            .await
            .map_err(|_| Error::Timeout)?;
        for _ in 0..4 {
            if Instant::now() >= deadline || Instant::now() >= use_until {
                return Err(Error::Timeout);
            }
            // Every attempt rebases on fresh acknowledged counters and opaque ETag.
            let Some((mut acknowledged, object)) = self.read(&seed, deadline).await? else {
                return Err(Error::Corrupt("rainfall authority absent"));
            };
            let mut decisions = Vec::new();
            for (oid, sensor) in &candidates {
                let row = acknowledged
                    .rows
                    .iter()
                    .find(|r| r.oid == *oid)
                    .ok_or(Error::Corrupt("rainfall candidate missing"))?;
                if row.last_end_ms.is_some_and(|n| n >= current.end) {
                    continue;
                }
                let Some(minute) = minutes.iter().find(|m| m.sensor == *sensor) else {
                    continue;
                };
                decisions.push((*oid, minute));
            }
            if decisions.is_empty() {
                return self.acknowledge(acknowledged, seed).map(Some);
            }
            let bindings: Vec<_> = decisions
                .iter()
                .map(|(id, m)| {
                    let row = acknowledged.rows.iter().find(|r| r.oid == *id).unwrap();
                    json!([
                        id,
                        row.rns_hit,
                        row.rns_count,
                        row.last_end_ms,
                        current.digest,
                        m.digest,
                        m.values.len(),
                        m.values.iter().filter(|v| v.is_some()).count(),
                        m.values.contains(&Some(true))
                    ])
                })
                .collect();
            let batch = digest(json!([
                "rns-batch-v1",
                acknowledged.activation.epoch,
                acknowledged.revision,
                current.grid,
                current.end,
                cutoff,
                bindings
            ]));
            acknowledged.revision = acknowledged
                .revision
                .checked_add(1)
                .filter(|n| *n <= SAFE)
                .ok_or(Error::Capacity)?;
            for (oid, minute) in decisions {
                let row = acknowledged.rows.iter_mut().find(|r| r.oid == oid).unwrap();
                update(row, minute, &current, cutoff, &batch)?;
            }
            acknowledged.validate(&seed, &self.store.target)?;
            let bytes = acknowledged.encode()?;
            let now = (self.clock)();
            if !now.is_finite() || now < acknowledged.activation.shutdown_at_ms as f64 {
                return Err(Error::Invalid("rainfall commit clock"));
            }
            if Instant::now() >= deadline || Instant::now() >= use_until {
                return Err(Error::Timeout);
            }
            match self
                .store
                .put(&bytes, &object.etag, deadline.min(use_until))
                .await
            {
                Ok(200) => return self.acknowledge(acknowledged, seed).map(Some),
                Ok(412) => continue,
                Ok(status) if (400..500).contains(&status) && status != 409 => {
                    return Err(Error::Status(status));
                }
                _ => {
                    self.release_member(intent);
                    // Never resend unknown bytes. Readback may recognize our exact buffer or an
                    // authoritative same-end/Ahead state; Ahead does not prove our historical PUT.
                    let Some((read, control)) = self.read(&seed, deadline).await? else {
                        return Err(Error::Ambiguous);
                    };
                    if control.body == bytes
                        || candidates.iter().all(|(id, _)| {
                            read.rows
                                .iter()
                                .find(|r| r.oid == *id)
                                .is_some_and(|r| r.last_end_ms.is_some_and(|n| n >= current.end))
                        })
                    {
                        return self.acknowledge(read, seed).map(Some);
                    }
                    return Err(Error::Ambiguous);
                }
            }
        }
        Err(Error::Capacity)
    }
}
fn update(
    row: &mut rainfall_store::Row,
    minute: &Minute,
    current: &Current,
    cutoff: u64,
    batch: &str,
) -> Result<(), Error> {
    let mut station = Doc::new();
    if let Some(n) = row.rns_hit {
        station.set("rnsHit", Val::Num(n));
    }
    if let Some(n) = row.rns_count {
        station.set("rnsCount", Val::Num(n));
    }
    let (hits, count) = rnshit::update(&station, current.pty, current.rn1, &minute.values)
        .ok_or(Error::Invalid("rainfall qualification"))?;
    let hit = minute.values.contains(&Some(true));
    if !rainfall_store::counter(Some(hits))
        || !rainfall_store::counter(Some(count))
        || count <= row.rns_count.unwrap_or(0.)
        || hit && hits <= row.rns_hit.unwrap_or(0.)
    {
        return Err(Error::Capacity);
    }
    row.rns_hit = Some(hits);
    row.rns_count = Some(count);
    row.last_end_ms = Some(current.end);
    row.receipt = Some(Receipt {
        end_ms: current.end,
        cutoff_at_ms: cutoff,
        grid: current.grid,
        current_sha256: current.digest.clone(),
        minute_sha256: minute.digest.clone(),
        batch_sha256: batch.into(),
        row_count: minute.values.len(),
        sensor_count: minute.values.iter().filter(|v| v.is_some()).count(),
        hit,
    });
    Ok(())
}
impl<T: CatalogTransport + Clone + Send + Sync + 'static> Lifecycle for Owner<T> {
    fn quiesce(&self) {
        self.accepting.store(false, Ordering::SeqCst);
    }
    fn drain(&self, deadline: Instant) -> BoxFuture<'_, bool> {
        Box::pin(async move {
            loop {
                if self.active.load(Ordering::SeqCst) == 0 && self.running.available_permits() == 1
                {
                    return true;
                }
                if timeout_at(deadline, tokio::time::sleep(Duration::from_millis(10)))
                    .await
                    .is_err()
                {
                    return false;
                }
            }
        })
    }
}
#[cfg(test)]
pub(super) mod tests {
    use super::*;
    fn owner() -> Arc<Owner<crate::world::BoundedS3<crate::storage::HttpS3Transport>>> {
        Owner::new(
            crate::world::BoundedS3::new(
                crate::storage::HttpS3Transport::new(
                    "http://127.0.0.1:9/",
                    "server2-local",
                    "ap-northeast-2",
                    rusty_s3::Credentials::new("owned", "owned"),
                )
                .unwrap(),
                1,
            ),
            Namespace::new("server2-local".into(), "ap-northeast-2".into()).unwrap(),
            Arc::new(|| 0.),
        )
        .unwrap()
    }
    #[derive(Clone, Default)]
    struct AuthorityGate {
        entered: Arc<tokio::sync::Notify>,
        release: Arc<tokio::sync::Notify>,
        reads: Arc<std::sync::atomic::AtomicUsize>,
    }
    impl crate::storage::ObjectTransport for AuthorityGate {
        async fn put(&self, _: &crate::storage::PreparedRecord) -> Result<u16, Error> {
            panic!("inactive authority must not write raw objects")
        }
        async fn head(&self, _: &str) -> Result<crate::storage::Object, Error> {
            panic!("inactive authority must not inspect raw objects")
        }
        async fn get(&self, _: &str, _: usize) -> Result<crate::storage::Object, Error> {
            panic!("inactive authority must not load raw objects")
        }
    }
    impl CatalogTransport for AuthorityGate {
        async fn get_control(
            &self,
            key: &str,
            _: usize,
        ) -> Result<crate::storage::ControlObject, Error> {
            assert_eq!(key, rainfall_store::KEY);
            self.reads.fetch_add(1, Ordering::SeqCst);
            self.entered.notify_one();
            self.release.notified().await;
            Err(Error::NotFound)
        }
        async fn put_control(
            &self,
            _: &str,
            _: &[u8],
            _: &crate::storage::WriteCondition,
        ) -> Result<u16, Error> {
            panic!("inactive authority must not write controls")
        }
        async fn list_raw_document(
            &self,
            _: &str,
            _: Option<&str>,
            _: usize,
            _: usize,
        ) -> Result<Vec<u8>, Error> {
            panic!("inactive authority must not scan inputs")
        }
    }
    fn gated_owner() -> (Arc<Owner<AuthorityGate>>, AuthorityGate) {
        let gate = AuthorityGate::default();
        let owner = Owner::new(
            gate.clone(),
            Namespace::new("server2-local".into(), "ap-northeast-2".into()).unwrap(),
            Arc::new(|| 1.),
        )
        .unwrap();
        (owner, gate)
    }
    #[tokio::test(start_paused = true)]
    async fn expired_outer_guard_returns_without_admitting_or_reading() {
        let (owner, gate) = gated_owner();
        let now = Instant::now();
        for remaining in [
            Duration::ZERO,
            Duration::from_millis(9),
            Duration::from_millis(10),
        ] {
            assert!(matches!(
                owner
                    .offer(
                        Arc::new(super::super::seed::embedded().clone()),
                        None,
                        now + remaining,
                        now + Duration::from_secs(1),
                    )
                    .await,
                Err(Error::Timeout)
            ));
            assert_eq!(
                Instant::now(),
                now,
                "no positive optional wait must not consume the answer margin"
            );
        }
        assert_eq!(gate.reads.load(Ordering::SeqCst), 0);
        assert_eq!(owner.offers.available_permits(), 8);
        owner.quiesce();
        assert!(owner.drain(now + Duration::from_secs(1)).await);
    }
    #[tokio::test(start_paused = true)]
    async fn caller_cutoff_and_outer_margin_bound_wait_while_owned_work_survives() {
        for source_reserve in [true, false] {
            let (owner, gate) = gated_owner();
            let now = Instant::now();
            let outer = now + Duration::from_secs(3);
            let caller_ready_by = if source_reserve {
                outer - Duration::from_millis(500)
            } else {
                outer + Duration::from_secs(1)
            };
            let expected = caller_ready_by.min(outer - Duration::from_millis(10));
            let reader = owner.clone();
            let caller = tokio::spawn(async move {
                reader
                    .offer(
                        Arc::new(super::super::seed::embedded().clone()),
                        None,
                        outer,
                        caller_ready_by,
                    )
                    .await
            });
            gate.entered.notified().await;
            tokio::time::advance(expected - now).await;
            assert!(matches!(caller.await.unwrap(), Err(Error::Timeout)));
            assert_eq!(
                Instant::now(),
                expected,
                "Source reserve must not lose an additional10ms"
            );
            assert_eq!(
                owner.active.load(Ordering::SeqCst),
                1,
                "caller timeout cannot cancel accepted authority read"
            );
            assert_eq!(owner.offers.available_permits(), 8);
            gate.release.notify_one();
            while owner.active.load(Ordering::SeqCst) != 0 {
                tokio::task::yield_now().await;
            }
            owner.quiesce();
            assert!(owner.drain(outer).await);
            assert_eq!(gate.reads.load(Ordering::SeqCst), 1);
        }
    }
    #[tokio::test(start_paused = true)]
    async fn expired_caller_cutoff_admits_once_and_returns_unknown_without_waiting() {
        for already_elapsed in [false, true] {
            let (owner, gate) = gated_owner();
            let now = Instant::now();
            let outer = now + Duration::from_secs(3);
            let cutoff = if already_elapsed {
                now - Duration::from_millis(1)
            } else {
                now
            };
            assert!(matches!(
                owner
                    .offer(
                        Arc::new(super::super::seed::embedded().clone()),
                        None,
                        outer,
                        cutoff
                    )
                    .await,
                Err(Error::Timeout)
            ));
            assert_eq!(Instant::now(), now);
            assert_eq!(
                owner.active.load(Ordering::SeqCst),
                1,
                "exactly one owned authority probe remains admitted"
            );
            gate.entered.notified().await;
            assert_eq!(gate.reads.load(Ordering::SeqCst), 1);
            assert_eq!(owner.running.available_permits(), 1);
            gate.release.notify_one();
            while owner.active.load(Ordering::SeqCst) != 0 {
                tokio::task::yield_now().await;
            }
            owner.quiesce();
            assert!(owner.drain(outer).await);
            assert_eq!(gate.reads.load(Ordering::SeqCst), 1);
        }
    }
    #[tokio::test(start_paused = true)]
    async fn validated_reply_before_caller_cutoff_keeps_confirmed_absence() {
        use std::task::Poll;
        let (owner, gate) = gated_owner();
        let outer = Instant::now() + Duration::from_secs(3);
        let cutoff = outer - Duration::from_millis(500);
        let offer = owner.offer(
            Arc::new(super::super::seed::embedded().clone()),
            None,
            outer,
            cutoff,
        );
        tokio::pin!(offer);
        std::future::poll_fn(|cx| {
            assert!(matches!(offer.as_mut().poll(cx), Poll::Pending));
            Poll::Ready(())
        })
        .await;
        gate.entered.notified().await;
        tokio::time::advance(Duration::from_millis(2499)).await;
        gate.release.notify_one();
        while owner.active.load(Ordering::SeqCst) != 0 {
            tokio::task::yield_now().await;
        }
        assert!(matches!(offer.await, Ok(None)));
        assert!(Instant::now() < cutoff);
        assert_eq!(gate.reads.load(Ordering::SeqCst), 1);
        owner.quiesce();
        assert!(owner.drain(outer).await);
    }
    #[tokio::test(start_paused = true)]
    async fn validated_authority_reply_and_expired_optional_timer_ready_together_choose_timeout() {
        use std::{future::Future, task::Poll};
        let (owner, gate) = gated_owner();
        let outer = Instant::now() + Duration::from_secs(3);
        let cutoff = outer - Duration::from_millis(500);
        let offer = owner.offer(
            Arc::new(super::super::seed::embedded().clone()),
            None,
            outer,
            cutoff,
        );
        tokio::pin!(offer);
        std::future::poll_fn(|cx| {
            assert!(matches!(offer.as_mut().poll(cx), Poll::Pending));
            Poll::Ready(())
        })
        .await;
        gate.entered.notified().await;
        // Do not poll this caller while advancing. Complete its real owned read so the oneshot
        // and timer are both ready when the exact Owner::offer future is next polled.
        tokio::time::advance(Duration::from_millis(2500)).await;
        gate.release.notify_one();
        while owner.active.load(Ordering::SeqCst) != 0 {
            tokio::task::yield_now().await;
        }
        assert_eq!(Instant::now(), cutoff);
        assert_eq!(gate.reads.load(Ordering::SeqCst), 1);
        println!(
            "caller3 race setup: real authority read completed; oneshot+expiredtimer ready; offers=8"
        );
        assert!(
            matches!(offer.await, Err(Error::Timeout)),
            "caller cutoff wins even when a validated confirmed-absent reply is already ready"
        );
        assert_eq!(gate.reads.load(Ordering::SeqCst), 1);
        owner.quiesce();
        assert!(owner.drain(outer).await);
    }
    #[tokio::test(start_paused = true)]
    async fn queued_offer_keeps_its_original_three_second_deadline() {
        let owner = owner();
        let held = owner.running.clone().acquire_owned().await.unwrap();
        let state = p2_state(&p2_seed(0));
        let original = Instant::now() + Duration::from_secs(3);
        let task = tokio::spawn({
            let owner = owner.clone();
            async move {
                owner
                    .flight(&state, 1, state.activation.first_end_ms, original, None)
                    .await
            }
        });
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(4)).await;
        assert!(matches!(task.await.unwrap(), Err(Error::Timeout)));
        drop(held);
        owner.quiesce();
        assert!(owner.drain(Instant::now() + Duration::from_secs(1)).await);
        assert!(matches!(
            owner
                .offer(
                    Arc::new(p2_seed(0)),
                    None,
                    Instant::now() + Duration::from_secs(1),
                    Instant::now() + Duration::from_secs(1)
                )
                .await,
            Err(Error::Capacity)
        ));
    }
    #[test]
    fn cancelled_parse_waiter_keeps_actual_blocking_reservation_until_completion() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .max_blocking_threads(1)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let owner = owner();
            let permit = Arc::new(owner.running.clone().acquire_owned().await.unwrap());
            let (release, wait) = std::sync::mpsc::channel();
            let (started, ready) = std::sync::mpsc::channel();
            let blocker = tokio::task::spawn_blocking(move || {
                started.send(()).unwrap();
                wait.recv().unwrap();
            });
            ready.recv_timeout(Duration::from_secs(1)).unwrap();
            let parse = rainfall_input::Parse {
                raws: vec![],
                sensors: vec![108.],
                start: 1,
                end: 2,
                catalog_bindings: vec![],
                bindings: vec![],
                cutoff: 1,
                deadline: Instant::now() + Duration::from_secs(3),
            }
            .spawn(permit);
            assert!(
                tokio::time::timeout(Duration::from_millis(20), parse)
                    .await
                    .is_err()
            );
            owner.quiesce();
            assert!(
                !owner
                    .drain(Instant::now() + Duration::from_millis(20))
                    .await,
                "timed-out waiter must not release a queued actualblockingtask's scratch"
            );
            release.send(()).unwrap();
            blocker.await.unwrap();
            assert!(owner.drain(Instant::now() + Duration::from_secs(1)).await);
        });
    }
    use crate::domestic::publication::Publication;
    use crate::history::schedule;
    use crate::storage::{
        CatalogId, CatalogTransport, ControlObject, GroupDeclaration, GroupMember, Object,
        ObjectTransport, PreparedRecord, ProviderKey, RawRecord, WriteCondition,
    };
    #[derive(Default)]
    struct MemoryState {
        controls: BTreeMap<String, ControlObject>,
        raws: BTreeMap<String, Object>,
        next: u64,
        probe_gate: Option<(Arc<Notify>, Arc<Notify>)>,
        state_puts: usize,
        minute_gets: usize,
        faults: std::collections::VecDeque<u16>,
    }
    #[derive(Clone, Default)]
    pub(in crate::domestic::kma::source) struct Memory(Arc<Mutex<MemoryState>>);
    impl ObjectTransport for Memory {
        async fn put(&self, r: &PreparedRecord) -> Result<u16, Error> {
            let mut s = self.0.lock().unwrap();
            if s.raws.contains_key(&r.key) {
                return Ok(412);
            }
            s.raws.insert(
                r.key.clone(),
                Object {
                    metadata: r.metadata.clone(),
                    length: r.body.len(),
                    body: r.body.clone(),
                },
            );
            Ok(200)
        }
        async fn head(&self, key: &str) -> Result<Object, Error> {
            self.0
                .lock()
                .unwrap()
                .raws
                .get(key)
                .cloned()
                .ok_or(Error::NotFound)
        }
        async fn get(&self, key: &str, maximum: usize) -> Result<Object, Error> {
            let mut s = self.0.lock().unwrap();
            if key.split('/').nth(3) == Some("aws-minute") {
                s.minute_gets += 1;
            }
            let o = s.raws.get(key).cloned().ok_or(Error::NotFound)?;
            if o.body.len() > maximum {
                return Err(Error::Capacity);
            }
            Ok(o)
        }
    }
    impl CatalogTransport for Memory {
        async fn get_control(&self, key: &str, maximum: usize) -> Result<ControlObject, Error> {
            let gate = if key == rainfall_store::KEY {
                self.0.lock().unwrap().probe_gate.take()
            } else {
                None
            };
            if let Some((entered, release)) = gate {
                entered.notify_one();
                release.notified().await;
            }
            let o = self
                .0
                .lock()
                .unwrap()
                .controls
                .get(key)
                .cloned()
                .ok_or(Error::NotFound)?;
            if o.body.len() > maximum {
                return Err(Error::Capacity);
            }
            Ok(o)
        }
        async fn put_control(
            &self,
            key: &str,
            body: &[u8],
            condition: &WriteCondition,
        ) -> Result<u16, Error> {
            let mut s = self.0.lock().unwrap();
            let lost = if key == rainfall_store::KEY {
                s.state_puts += 1;
                match s.faults.pop_front() {
                    Some(0) => true,
                    Some(code) => return Ok(code),
                    None => false,
                }
            } else {
                false
            };
            let allowed = match condition {
                WriteCondition::Absent => !s.controls.contains_key(key),
                WriteCondition::Match(etag) => s.controls.get(key).is_some_and(|o| &o.etag == etag),
            };
            if !allowed {
                return Ok(412);
            }
            s.next += 1;
            let n = s.next;
            s.controls.insert(
                key.into(),
                ControlObject {
                    body: body.to_vec(),
                    etag: format!("\"owned-{n}\""),
                    version: Some(n.to_string()),
                },
            );
            if lost { Err(Error::Transport) } else { Ok(200) }
        }
        async fn list_raw_document(
            &self,
            _: &str,
            _: Option<&str>,
            _: usize,
            _: usize,
        ) -> Result<Vec<u8>, Error> {
            panic!("targeted S06 proof must not scan raw keys")
        }
    }
    impl crate::history::IndexListing for Memory {
        async fn list_index(
            &self,
            _: &str,
            _: Option<&str>,
        ) -> Result<crate::storage::ListPage, Error> {
            panic!("direct owned fold must not scan history")
        }
    }
    pub(in crate::domestic::kma::source) fn p2_seed_bytes(variant: u8) -> Vec<u8> {
        let docs = format!(
            "{}\n{}\n",
            json!({"_id":{"$oid":"000000000000000000000108"},"stnId":"108","stnName":"서울",
                "addr":format!("owned-p2-{variant}-seoul"),"geo":[126.9658,37.5714],
                "rnsHit":if variant==2 {0}else{3},"rnsCount":4,"isCityWeather":true}),
            json!({"_id":{"$oid":"000000000000000000000159"},"stnId":"159","stnName":"부산",
                "addr":format!("owned-p2-{variant}-busan"),"geo":[129.0756,35.1796],
                "rnsHit":3,"rnsCount":4,"isCityWeather":true})
        );
        format!(
            "{}\n{docs}",
            json!({"schema":1,"tool":"export_station_seeds","collection":"kmastninfos",
            "exportedAt":"2026-10-16T00:00:00Z","documents":2,
            "sourceSha256":crate::storage::sha256(docs.as_bytes())})
        )
        .into_bytes()
    }
    pub(in crate::domestic::kma::source) fn p2_seed(v: u8) -> StationSeed {
        super::super::seed::parse(&p2_seed_bytes(v)).unwrap()
    }
    fn p2_state(seed: &StationSeed) -> Checkpoint {
        let rows = rainfall_store::baseline(seed).unwrap();
        Checkpoint::initial(
            rainfall_store::Activation {
                epoch: digest(json!(["owned-p2-epoch"])),
                policy: rainfall_store::POLICY.into(),
                target: Namespace::new("server2-local".into(), "ap-northeast-2".into()).unwrap(),
                source: rainfall_store::Source {
                    store: "mongo".into(),
                    database: "owned-test".into(),
                    collection: "kmastninfos".into(),
                },
                seed_body_sha256: seed.body_sha256.clone(),
                seed_source_sha256: seed.source_sha256.clone(),
                seed_exported_at_ms: seed.exported_at_ms,
                seed_documents: seed.docs.len(),
                seed_identity_sha256: rainfall_store::identity_digest(&rows),
                baseline_sha256: rainfall_store::baseline_digest(seed, &rows),
                shutdown_at_ms: seed.exported_at_ms - 60_000,
                shutdown_evidence_sha256: digest(json!(["owned-p2-shutdown"])),
                first_end_ms: (schedule::to_ms(Publication::new(20261017, 1000).unwrap()) as u64)
                    + rainfall_store::KST,
                first_end_basis: "full-post-shutdown-hour".into(),
                legacy_highwater_ms: None,
            },
            seed,
            &Namespace::new("server2-local".into(), "ap-northeast-2".into()).unwrap(),
        )
        .unwrap()
    }
    fn p2_current(state: &Checkpoint, n: usize) -> Current {
        let (lat, lon) = if n == 0 {
            (37.5714, 126.9658)
        } else {
            (35.1796, 129.0756)
        };
        let (nx, ny) = grid_of(lat, lon);
        let grid = [nx as u16, ny as u16];
        Current {
            grid,
            end: state.activation.first_end_ms,
            pty: 1.,
            rn1: 0.5,
            digest: digest(json!([
                "owned-current",
                grid,
                state.activation.first_end_ms
            ])),
        }
    }
    async fn p2_publish(store: &CatalogStore<Memory>, raw: RawRecord) {
        let id = CatalogId::for_record(
            &raw.envelope.identity,
            &raw.envelope.identity.period.local_date.to_string(),
        )
        .unwrap();
        let declaration = GroupDeclaration::new(
            vec![GroupMember {
                envelope: raw.envelope.clone(),
                catalogs: vec![id],
            }],
            &CatalogLimits::default(),
        )
        .unwrap();
        store
            .publish(
                declaration,
                vec![raw],
                Instant::now() + Duration::from_secs(10),
            )
            .await
            .unwrap();
    }

    fn p2_minute(at: Publication, rain: bool) -> Vec<u8> {
        let mark = if rain {
            "<font color=blue>●</font>"
        } else {
            "<font color=red>○</font>"
        };
        let columns = [
            "108",
            "서울",
            "86m",
            mark,
            "0",
            "0",
            "0",
            "0",
            "0",
            "0",
            "18.4",
            "270.1",
            "W",
            "1.2",
            "265.0",
            "WSW",
            "1.4",
            "61",
            "1013.2",
            "서울특별시 종로구 송월동",
        ];
        let cells: String = columns.iter().map(|c| format!("<td>{c}</td>")).collect();
        let second = cells
            .replacen("<td>108</td>", "<td>159</td>", 1)
            .replacen("<td>서울</td>", "<td>부산</td>", 1)
            .replacen("서울특별시 종로구 송월동", "부산광역시", 1);
        let cells = format!("{cells}</tr><tr align=center class=text>{second}");
        let html = format!(
            concat!(
                r#"<HTML><HEAD><META http-equiv="Content-Type" content="text/html; charset=euc-kr"></HEAD><BODY>"#,
                "\n",
                r#"<span class=ehead>[ 매분관측자료 ] 2026.10.17.{:02}:{:02}</span>"#,
                "\n",
                r#"<table border=0 cellspacing=0 cellpadding=0><tr><td bgcolor=#999999><table border=0 cellspacing=1 cellpadding=1>"#,
                "\n",
                r#"<tr bgcolor=#AAE3FF align=center class=name><td colspan=3 nowrap>AWS 지점 / 고도</td><td>강수</td><td>강수15</td><td>강수60</td><td>강수3H</td><td>강수6H</td><td>강수12H</td><td>일강수</td><td width=40>기온</td><td colspan=2 width=60>풍향1</td><td>풍속1(m/s)</td><td colspan=2 width=60>풍향10</td><td>풍속10(m/s)</td><td>습도</td><td>해면기압</td><td>위치</td></tr>"#,
                "\n",
                r#"<tr align=center class=text>{cells}</tr>"#,
                "\n",
                r#"</table></td></tr></table></BODY></HTML>"#
            ),
            at.hour(),
            at.minute(),
            cells = cells
        );
        encoding_rs::EUC_KR.encode(&html).0.into_owned()
    }

    async fn p2_fixture(extra: bool) -> (Memory, Arc<StationSeed>, Checkpoint) {
        let memory = Memory::default();
        let catalog = CatalogStore::new(memory.clone(), CatalogLimits::default()).unwrap();
        let acquisition = super::super::seed::acquisition(&p2_seed_bytes(0)).unwrap();
        catalog
            .publish(
                acquisition.declaration,
                acquisition.records,
                Instant::now() + Duration::from_secs(10),
            )
            .await
            .unwrap();
        let seed = Arc::new(p2_seed(0));
        let state = p2_state(&seed);
        assert_eq!(
            candidates(&seed, &p2_current(&state, 0)).len(),
            1,
            "setup: real grid selects Seoul OID"
        );
        assert_eq!(
            candidates(&seed, &p2_current(&state, 1)).len(),
            1,
            "setup: real grid selects Busan OID"
        );
        assert_ne!(p2_current(&state, 0).grid, p2_current(&state, 1).grid);
        for minute in 1..=15 {
            let at = Publication::new(20261017, 900 + minute).unwrap();
            let body = p2_minute(at, false);
            let page = super::super::pages::parse_aws(&body, None).unwrap();
            assert_eq!(
                page.rows.len(),
                2,
                "actual encoded national page has both sensors"
            );
            let raw = RawRecord::new(
                "kma-web",
                "aws-minute",
                &ProviderKey::Named {
                    id: "aws-national".into(),
                },
                at.period(),
                (schedule::to_ms(at) + 30_000) as u64,
                200,
                "text/html;charset=euc-kr",
                None,
                body.into(),
                &CatalogLimits::default().raw,
            )
            .unwrap();
            p2_publish(&catalog, raw).await;
        }
        if extra {
            let at = Publication::new(20261017, 901).unwrap();
            let fetched = schedule::to_ms(Publication::new(20261017, 1047).unwrap()) + 30_000;
            p2_publish(
                &catalog,
                RawRecord::new(
                    "kma-web",
                    "aws-minute",
                    &ProviderKey::Named {
                        id: "aws-national".into(),
                    },
                    at.period(),
                    fetched as u64,
                    200,
                    "text/html;charset=euc-kr",
                    None,
                    p2_minute(at, true).into(),
                    &CatalogLimits::default().raw,
                )
                .unwrap(),
            )
            .await;
        }
        assert_eq!(
            memory
                .put_control(
                    rainfall_store::KEY,
                    &state.encode().unwrap(),
                    &WriteCondition::Absent
                )
                .await
                .unwrap(),
            200
        );
        {
            let mut counters = memory.0.lock().unwrap();
            counters.state_puts = 0;
            counters.minute_gets = 0;
        }
        (memory, seed, state)
    }
    fn p2_owner(memory: Memory) -> Arc<Owner<Memory>> {
        let mut owner = Owner::new(
            memory,
            Namespace::new("server2-local".into(), "ap-northeast-2".into()).unwrap(),
            Arc::new(|| schedule::to_ms(Publication::new(20261017, 1047).unwrap()) as f64),
        )
        .unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        Arc::get_mut(&mut owner).unwrap().cutoff = Arc::new(move || {
            Ok(
                (schedule::to_ms(Publication::new(20261017, 1047).unwrap()) as u64)
                    + calls.fetch_add(1, Ordering::SeqCst) as u64 * 60_000,
            )
        });
        owner
    }
    #[tokio::test(start_paused = true)]
    async fn p2_first_eight_intents_survive_cancel_and_same_grid_ninth_joins_before_cap() {
        let (owner, gate) = gated_owner();
        let until = Instant::now() + Duration::from_secs(3);
        let base = p2_state(&p2_seed(0));
        let mut readers = Vec::new();
        for n in 0..9 {
            let owner = owner.clone();
            let mut current = p2_current(&base, 0);
            current.grid[0] = 60 + (n % 8);
            current.digest = digest(json!(["owned-current", current.grid, current.end]));
            readers.push(tokio::spawn(async move {
                owner
                    .offer(Arc::new(p2_seed(0)), Some(current), until, until)
                    .await
            }));
        }
        gate.entered.notified().await;
        while owner.coord.lock().unwrap().intents.len() < 8 {
            tokio::task::yield_now().await;
        }
        for _ in 0..10_000 {
            if owner.readers.available_permits() == 119 {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert_eq!(
            owner.readers.available_permits(),
            119,
            "same-grid ninth is a live joiner, not Capacity"
        );
        assert_eq!(owner.offers.available_permits(), 0);
        assert_eq!(
            gate.reads.load(Ordering::SeqCst),
            1,
            "single real in-flight404 read"
        );
        for reader in readers {
            reader.abort();
            assert!(matches!(reader.await,Err(e) if e.is_cancelled()));
        }
        assert_eq!(
            owner.coord.lock().unwrap().intents.len(),
            8,
            "waiter cancellation is not intent cancellation"
        );
        gate.release.notify_one();
        owner.quiesce();
        assert!(owner.drain(until).await);
        assert!(owner.coord.lock().unwrap().intents.is_empty());
        assert_eq!(owner.offers.available_permits(), 8);
    }
    #[tokio::test(start_paused = true)]
    async fn p2_read_tickets_128_do_not_consume_mutation_capacity_and_129_is_unknown() {
        use std::{future::Future, task::Poll};
        let (owner, gate) = gated_owner();
        let until = Instant::now() + Duration::from_secs(3);
        let mut pending: Vec<_> = (0..128)
            .map(|_| Box::pin(owner.offer(Arc::new(p2_seed(0)), None, until, until)))
            .collect();
        std::future::poll_fn(|cx| {
            for future in &mut pending {
                assert!(matches!(future.as_mut().poll(cx), Poll::Pending));
            }
            Poll::Ready(())
        })
        .await;
        assert_eq!(owner.offers.available_permits(), 8);
        assert_eq!(owner.readers.available_permits(), 0);
        assert!(matches!(
            owner.offer(Arc::new(p2_seed(0)), None, until, until).await,
            Err(Error::Capacity)
        ));
        gate.entered.notified().await;
        drop(pending);
        assert_eq!(owner.readers.available_permits(), 128);
        assert_eq!(owner.active.load(Ordering::SeqCst), 1);
        gate.release.notify_one();
        owner.quiesce();
        assert!(owner.drain(until).await);
    }

    // Small private Owner + real S06 control, not public Source/HTTP or capacity proof.
    const P2_EIGHT_STATIONS: [(u16, &str, f64, f64); 8] = [
        (108, "서울", 126.9658, 37.5714),
        (159, "부산", 129.0756, 35.1796),
        (143, "대구", 128.6190, 35.8770),
        (112, "인천", 126.6249, 37.4777),
        (156, "광주", 126.8916, 35.1729),
        (133, "대전", 127.3721, 36.3720),
        (152, "울산", 129.3347, 35.5600),
        (184, "제주", 126.5297, 33.5141),
    ];
    fn p2_eight_seed_bytes() -> Vec<u8> {
        let docs: String = P2_EIGHT_STATIONS
            .iter()
            .map(|(sensor, name, lon, lat)| {
                format!(
                    "{}\n",
                    json!({"_id":{"$oid":format!("{sensor:024x}")},
                "stnId":sensor.to_string(),"stnName":name,"addr":format!("owned-p2-eight-{sensor}"),
                "geo":[lon,lat],"rnsHit":3,"rnsCount":4,"isCityWeather":true})
                )
            })
            .collect();
        format!(
            "{}\n{docs}",
            json!({"schema":1,"tool":"export_station_seeds",
            "collection":"kmastninfos","exportedAt":"2026-10-16T00:00:00Z",
            "documents":8,"sourceSha256":crate::storage::sha256(docs.as_bytes())})
        )
        .into_bytes()
    }
    fn p2_eight_current(state: &Checkpoint, n: usize) -> Current {
        let (_, _, lon, lat) = P2_EIGHT_STATIONS[n];
        let (nx, ny) = grid_of(lat, lon);
        Current {
            grid: [nx as u16, ny as u16],
            end: state.activation.first_end_ms,
            pty: 1.,
            rn1: 0.5,
            digest: digest(json!([
                "owned-eight-current",
                nx as u16,
                ny as u16,
                state.activation.first_end_ms
            ])),
        }
    }
    fn p2_eight_minute(at: Publication) -> Vec<u8> {
        // Reuse the existing exact20-column national HTML fixture/header and EUC-KR encoding.
        let original = p2_minute(at, false);
        let decoded = encoding_rs::EUC_KR.decode(&original).0.into_owned();
        let marker = "<tr align=center class=text>";
        let start = decoded.find(marker).expect("setup: first actual data row");
        let end = start
            + decoded[start..]
                .find("</tr>")
                .expect("setup: first row close")
            + 5;
        let after_second = end
            + decoded[end..]
                .find("</tr>")
                .expect("setup: second row close")
            + 5;
        let first = &decoded[start..end];
        let rows: String = P2_EIGHT_STATIONS
            .iter()
            .map(|(sensor, name, _, _)| {
                first
                    .replacen("<td>108</td>", &format!("<td>{sensor}</td>"), 1)
                    .replacen("<td>서울</td>", &format!("<td>{name}</td>"), 1)
            })
            .collect();
        let html = format!("{}{rows}{}", &decoded[..start], &decoded[after_second..]);
        encoding_rs::EUC_KR.encode(&html).0.into_owned()
    }
    async fn p2_eight_fixture() -> (Memory, Arc<StationSeed>, Checkpoint) {
        let memory = Memory::default();
        let catalog = CatalogStore::new(memory.clone(), CatalogLimits::default()).unwrap();
        let bytes = p2_eight_seed_bytes();
        let seed =
            Arc::new(super::super::seed::parse(&bytes).expect("setup: complete eight-OID export"));
        assert_eq!(seed.docs.len(), 8);
        let ids: BTreeSet<_> = seed.identities.iter().copied().flatten().collect();
        assert_eq!(
            ids.len(),
            8,
            "setup: actual imported original identities, not mutated witness grids"
        );
        let acquisition = super::super::seed::acquisition(&bytes).expect("setup: seed acquisition");
        catalog
            .publish(
                acquisition.declaration,
                acquisition.records,
                Instant::now() + Duration::from_secs(10),
            )
            .await
            .expect("setup: complete S06 seed publish");
        let state = p2_state(&seed);
        let mut grids = BTreeSet::new();
        for n in 0..8 {
            let current = p2_eight_current(&state, n);
            assert!((1..=149).contains(&current.grid[0]) && (1..=253).contains(&current.grid[1]));
            assert!(
                grids.insert(current.grid),
                "setup: eight distinct real coordinate-derived grids"
            );
            let selected = candidates(&seed, &current);
            assert_eq!(
                selected.len(),
                1,
                "setup: exactly one original OID in each offered grid"
            );
            assert!(ids.contains(&selected[0].0));
        }
        let sensors: BTreeSet<_> = P2_EIGHT_STATIONS
            .iter()
            .map(|(id, _, _, _)| id.to_string())
            .collect();
        for minute in 1..=15 {
            let at = Publication::new(20261017, 900 + minute).unwrap();
            let body = p2_eight_minute(at);
            let parsed = super::super::pages::parse_aws(&body, None)
                .expect("setup: actual encoded eight-sensor page");
            assert_eq!(parsed.rows.len(), 8);
            let actual: BTreeSet<_> = parsed
                .rows
                .iter()
                .map(|r| {
                    r.get("stnId")
                        .and_then(Val::as_str)
                        .expect("setup: sensor identity")
                        .to_owned()
                })
                .collect();
            assert_eq!(
                actual, sensors,
                "setup: all eight actual numeric joins exist on every page"
            );
            assert!(
                parsed
                    .rows
                    .iter()
                    .all(|r| r.get("rns") == Some(&Val::Bool(false)))
            );
            p2_publish(
                &catalog,
                RawRecord::new(
                    "kma-web",
                    "aws-minute",
                    &ProviderKey::Named {
                        id: "aws-national".into(),
                    },
                    at.period(),
                    (schedule::to_ms(at) + 30_000) as u64,
                    200,
                    "text/html;charset=euc-kr",
                    None,
                    body.into(),
                    &CatalogLimits::default().raw,
                )
                .unwrap(),
            )
            .await;
        }
        assert_eq!(
            memory
                .put_control(
                    rainfall_store::KEY,
                    &state.encode().unwrap(),
                    &WriteCondition::Absent
                )
                .await
                .expect("setup: ordinary active authority"),
            200
        );
        let store = Store {
            transport: memory.clone(),
            target: state.activation.target.clone(),
        };
        let (read, _, imported) = store
            .resolve(
                seed.clone(),
                &catalog,
                Instant::now() + Duration::from_secs(10),
            )
            .await
            .expect("setup: exact imported seed proof")
            .unwrap();
        assert_eq!(read, state);
        assert_eq!(imported.body_sha256, seed.body_sha256);
        assert_eq!(rainfall_store::baseline(&imported).unwrap().len(), 8);
        let cutoff = schedule::to_ms(Publication::new(20261017, 1047).unwrap()) as u64;
        let mut expected = None;
        for n in 0..8 {
            // Full independent setup validation precedes ownership/parse/counter assertions.
            let plan = rainfall_input::validate(
                &memory,
                &catalog,
                &p2_eight_current(&state, n),
                cutoff + n as u64 * 60_000,
                Instant::now() + Duration::from_secs(10),
                false,
            )
            .await
            .expect("setup: complete fifteen-member national replay");
            assert_eq!(plan.ordered.len(), 15);
            if let Some(ordered) = &expected {
                assert_eq!(&plan.ordered, ordered);
            } else {
                expected = Some(plan.ordered.clone());
            }
        }
        {
            let mut s = memory.0.lock().unwrap();
            s.state_puts = 0;
            s.minute_gets = 0;
        }
        (memory, seed, state)
    }
    #[tokio::test]
    async fn p2_eight_real_grids_complete_owned_batches_after_all_waiters_cancel_with_one_parse() {
        use std::{future::Future, task::Poll};
        let (memory, seed, state) = p2_eight_fixture().await;
        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        memory.0.lock().unwrap().probe_gate = Some((entered.clone(), release.clone()));
        let mut owner = p2_owner(memory.clone());
        let sampled = Arc::new(Mutex::new(Vec::new()));
        let captured = sampled.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let count = calls.clone();
        let base = schedule::to_ms(Publication::new(20261017, 1047).unwrap()) as u64;
        Arc::get_mut(&mut owner).unwrap().cutoff = Arc::new(move || {
            let ci = base + count.fetch_add(1, Ordering::SeqCst) as u64 * 60_000;
            captured.lock().unwrap().push(ci);
            Ok(ci)
        });
        let until = Instant::now() + Duration::from_secs(3);
        let mut callers: Vec<_> = (0..8)
            .map(|n| {
                Box::pin(owner.offer(
                    seed.clone(),
                    Some(p2_eight_current(&state, n)),
                    until,
                    until,
                ))
            })
            .collect();
        std::future::poll_fn(|cx| {
            for caller in &mut callers {
                assert!(matches!(caller.as_mut().poll(cx), Poll::Pending));
            }
            Poll::Ready(())
        })
        .await;
        let deadlines: BTreeMap<_, _> = owner
            .coord
            .lock()
            .unwrap()
            .intents
            .iter()
            .map(|(key, intent)| (*key, intent.deadline))
            .collect();
        assert_eq!(
            deadlines.len(),
            8,
            "all eight real decisions registered before first await"
        );
        assert!(
            deadlines
                .values()
                .all(|di| *di >= until && *di <= Instant::now() + Duration::from_secs(3))
        );
        tokio::time::timeout_at(until, entered.notified())
            .await
            .expect("owned authority probe entered");
        tokio::time::timeout_at(until, async {
            while calls.load(Ordering::SeqCst) < 8 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("all eight original work-entry cutoffs sampled before shared probe completes");
        assert_eq!(calls.load(Ordering::SeqCst), 8);
        assert_eq!(memory.0.lock().unwrap().minute_gets, 0);
        assert_eq!(memory.0.lock().unwrap().state_puts, 0);
        drop(callers); // Cancel all caller futures; the eight accepted decisions stay owned.
        assert_eq!(owner.readers.available_permits(), 128);
        let still_owned: BTreeMap<_, _> = owner
            .coord
            .lock()
            .unwrap()
            .intents
            .iter()
            .map(|(key, intent)| (*key, intent.deadline))
            .collect();
        assert_eq!(
            still_owned, deadlines,
            "cancellation does not replace or extend originalDi"
        );
        owner.quiesce();
        release.notify_one();
        assert!(
            owner.drain(until).await,
            "small admitted workload must actually retire within original deadlines"
        );
        assert_eq!(
            calls.load(Ordering::SeqCst),
            8,
            "no resampled Ci after validation/writer waits"
        );
        assert_eq!(
            owner.parses.load(Ordering::SeqCst),
            1,
            "one owner projection after equal independently proven full membership"
        );
        {
            let s = memory.0.lock().unwrap();
            assert_eq!(
                s.minute_gets,
                8 * 15,
                "eight independent complete S06/raw proofs, not network dedup"
            );
            assert_eq!(
                s.state_puts, 8,
                "exactly eight atomic grid batches, no repeated contribution"
            );
        }
        let final_state = owner
            .pinned()
            .expect("actual acknowledged final state")
            .state;
        assert_eq!(
            final_state.revision, 9,
            "activation1 plus eight atomic batches"
        );
        assert_eq!(final_state.rows.len(), 8);
        let expected_cutoffs: BTreeSet<_> = sampled.lock().unwrap().iter().copied().collect();
        assert_eq!(
            expected_cutoffs,
            (0..8).map(|n| base + n * 60_000).collect()
        );
        let mut receipt_cutoffs = BTreeSet::new();
        let mut receipt_grids = BTreeSet::new();
        for row in &final_state.rows {
            assert_eq!((row.rns_hit, row.rns_count), (Some(3.), Some(5.)));
            let receipt = row
                .receipt
                .as_ref()
                .expect("each original OID has a receipt");
            assert_eq!(row.last_end_ms, Some(state.activation.first_end_ms));
            assert_eq!(receipt.end_ms, state.activation.first_end_ms);
            assert_eq!(
                (receipt.row_count, receipt.sensor_count, receipt.hit),
                (15, 15, false)
            );
            receipt_cutoffs.insert(receipt.cutoff_at_ms);
            receipt_grids.insert(receipt.grid);
            let current = Current {
                grid: receipt.grid,
                end: receipt.end_ms,
                pty: 1.,
                rn1: 0.5,
                digest: receipt.current_sha256.clone(),
            };
            assert_eq!(
                candidates(&seed, &current)[0].0,
                row.oid,
                "receipt grid binds its actual original OID"
            );
        }
        assert_eq!(receipt_cutoffs, expected_cutoffs);
        assert_eq!(receipt_grids.len(), 8);
        assert_eq!(owner.offers.available_permits(), 8);
        assert_eq!(
            owner.running.available_permits(),
            1,
            "real heavy reservation retired"
        );
        assert!(owner.coord.lock().unwrap().intents.is_empty());
        assert!(
            owner.coord.lock().unwrap().flight.is_none(),
            "no completed flight TTL"
        );
    }

    #[tokio::test]
    async fn p2_two_grids_independently_validate_same_membership_parse_once_and_keep_own_cutoffs() {
        let (memory, seed, state) = p2_fixture(false).await;
        let owner = p2_owner(memory.clone());
        let until = Instant::now() + Duration::from_secs(3);
        let (a, b) = tokio::join!(
            owner.offer(seed.clone(), Some(p2_current(&state, 0)), until, until),
            owner.offer(seed.clone(), Some(p2_current(&state, 1)), until, until)
        );
        let a = a.unwrap().unwrap();
        let b = b.unwrap().unwrap();
        assert_eq!(
            owner.parses.load(Ordering::SeqCst),
            1,
            "actual shared encoded national replay parsed once"
        );
        {
            let s = memory.0.lock().unwrap();
            assert_eq!(
                s.minute_gets, 30,
                "two independent15-member S06/raw validations"
            );
            assert_eq!(
                s.state_puts, 2,
                "two atomic grid batches, not40/cumulative duplicates"
            );
        }
        let final_state = owner.pinned().unwrap().state;
        assert_eq!(final_state.revision, 3);
        assert!(
            final_state
                .rows
                .iter()
                .all(|r| r.rns_hit == Some(3.) && r.rns_count == Some(5.))
        );
        let cutoffs: BTreeSet<_> = final_state
            .rows
            .iter()
            .map(|r| r.receipt.as_ref().unwrap().cutoff_at_ms)
            .collect();
        assert_eq!(
            cutoffs.len(),
            2,
            "each accepted work-entry Ci survives sharing"
        );
        assert_ne!(a.state.revision, b.state.revision);
        owner.quiesce();
        assert!(owner.drain(until).await);
    }
    #[tokio::test]
    async fn p2_changed_complete_membership_reparses_after_retirement_without_resampling_cutoff() {
        let (memory, seed, state) = p2_fixture(true).await;
        let owner = p2_owner(memory.clone());
        let until = Instant::now() + Duration::from_secs(3);
        let (a, b) = tokio::join!(
            owner.offer(seed.clone(), Some(p2_current(&state, 0)), until, until),
            owner.offer(seed.clone(), Some(p2_current(&state, 1)), until, until)
        );
        a.unwrap().unwrap();
        b.unwrap().unwrap();
        assert_eq!(
            owner.parses.load(Ordering::SeqCst),
            2,
            "different full envelopes cannot reuse a projection"
        );
        let state = owner.pinned().unwrap().state;
        let cutoffs: BTreeSet<_> = state
            .rows
            .iter()
            .map(|r| r.receipt.as_ref().unwrap().cutoff_at_ms)
            .collect();
        let start = schedule::to_ms(Publication::new(20261017, 1047).unwrap()) as u64;
        assert_eq!(cutoffs, BTreeSet::from([start, start + 60_000]));
        assert_eq!(
            state.rows.iter().filter(|r| r.rns_hit == Some(4.)).count(),
            1
        );
        assert!(state.rows.iter().all(|r| r.rns_count == Some(5.)));
        owner.quiesce();
        assert!(owner.drain(until).await);
    }
    #[tokio::test(start_paused = true)]
    async fn p2_flight_pending_member_outlives_first_producer_and_physical_guard_blocks_next() {
        let owner = owner();
        let state = p2_state(&p2_seed(0));
        let now = Instant::now();
        let end = state.activation.first_end_ms;
        {
            let mut c = owner.coord.lock().unwrap();
            for id in [1, 2] {
                c.intents.insert(
                    ([id as u16, 127], end),
                    Intent {
                        id,
                        deadline: now + Duration::from_secs(3),
                        pending_input: true,
                        reply: Reply::new(now + Duration::from_secs(3)),
                    },
                );
            }
        }
        let first = owner
            .flight(&state, 1, end, now + Duration::from_secs(3), None)
            .await
            .unwrap();
        let second = owner
            .flight(&state, 2, end, now + Duration::from_secs(3), None)
            .await
            .unwrap();
        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(owner.running.available_permits(), 0);
        owner.finish_intent(([1, 127], end), 1);
        drop(first);
        assert!(
            owner.coord.lock().unwrap().flight.is_some(),
            "pending validator is an owner"
        );
        let physical = second.workspace.clone();
        owner.finish_intent(([2, 127], end), 2);
        drop(second);
        assert!(
            owner.coord.lock().unwrap().flight.is_none(),
            "no completed-view TTL"
        );
        assert!(
            !owner.drain(now + Duration::from_millis(1)).await,
            "actual blocking guard retains reservation"
        );
        let deadline = now + Duration::from_secs(2);
        let next = tokio::spawn({
            let owner = owner.clone();
            async move { owner.flight(&state, 3, end, deadline, None).await }
        });
        tokio::task::yield_now().await;
        assert!(!next.is_finished());
        drop(physical);
        let next = next.await.unwrap().unwrap();
        assert_eq!(next.until, deadline);
        owner.release_member(3);
        drop(next);
        owner.quiesce();
        assert!(owner.drain(now + Duration::from_secs(3)).await);
    }
    #[test]
    fn p2_pool_nine_versions_monotonic_first_seen_and_signed_zero_equivocation() {
        let owner = owner();
        let seed = Arc::new(p2_seed(0));
        let initial = p2_state(&seed);
        let mut held = Vec::new();
        for revision in 1..=9 {
            let mut s = initial.clone();
            s.revision = revision;
            held.push(owner.acknowledge(s, seed.clone()).unwrap());
        }
        assert_eq!(owner.versions.lock().unwrap().len(), 9);
        let mut tenth = initial.clone();
        tenth.revision = 10;
        assert!(matches!(
            owner.acknowledge(tenth.clone(), seed.clone()),
            Err(Error::Capacity)
        ));
        assert_eq!(
            owner.pinned().unwrap().acknowledged_revision,
            10,
            "durable known state survives delivery capacity"
        );
        held.remove(0);
        let a = owner.acknowledge(tenth.clone(), seed.clone()).unwrap();
        let b = owner.acknowledge(tenth, seed.clone()).unwrap();
        assert!(Arc::ptr_eq(&a.state, &b.state));
        assert_eq!(a.since, b.since);
        assert!(matches!(
            owner.acknowledge(initial.clone(), seed.clone()),
            Err(Error::Corrupt(_))
        ));
        let mut plus = initial.clone();
        plus.rows[0].rns_hit = Some(0.);
        let mut minus = plus.clone();
        minus.rows[0].rns_hit = Some(-0.);
        assert!(
            !same_state(&plus, &minus),
            "floating PartialEq must not erase counter bits"
        );
        let bit_seed = Arc::new(p2_seed(2));
        let positive = p2_state(&bit_seed);
        let mut negative = positive.clone();
        negative.rows[0].rns_hit = Some(-0.);
        positive
            .validate(&bit_seed, &positive.activation.target)
            .unwrap();
        negative
            .validate(&bit_seed, &negative.activation.target)
            .unwrap();
        let bits = self::owner();
        bits.acknowledge(positive, bit_seed.clone()).unwrap();
        assert!(matches!(
            bits.acknowledge(negative, bit_seed),
            Err(Error::Corrupt(_))
        ));
        let activation = &a.state.activation;
        let strings = [
            &activation.epoch,
            &activation.policy,
            &activation.target.bucket,
            &activation.target.region,
            &activation.source.store,
            &activation.source.database,
            &activation.source.collection,
            &activation.seed_body_sha256,
            &activation.seed_source_sha256,
            &activation.seed_identity_sha256,
            &activation.baseline_sha256,
            &activation.shutdown_evidence_sha256,
            &activation.first_end_basis,
        ]
        .iter()
        .map(|s| s.capacity())
        .sum::<usize>();
        let receipts = a
            .state
            .rows
            .iter()
            .filter_map(|r| r.receipt.as_ref())
            .map(|r| {
                r.current_sha256.capacity() + r.minute_sha256.capacity() + r.batch_sha256.capacity()
            })
            .sum::<usize>();
        let capacity = std::mem::size_of::<Checkpoint>()
            + a.state.rows.capacity() * std::mem::size_of::<rainfall_store::Row>()
            + strings
            + receipts;
        println!(
            "p2 decoded owned-capacity bytes={capacity} rows_capacity={} versions={}; excludes allocator overhead/Arc and RSS",
            a.state.rows.capacity(),
            owner.versions.lock().unwrap().len()
        );
    }
    #[tokio::test]
    async fn p2_exact_candidate_still_requires_s06_import_and_activation_prerequisite_is_zero_put()
    {
        let memory = Memory::default();
        let seed = Arc::new(p2_seed(0));
        let state = p2_state(&seed);
        let catalog = CatalogStore::new(memory.clone(), CatalogLimits::default()).unwrap();
        let store = Store {
            transport: memory.clone(),
            target: state.activation.target.clone(),
        };
        memory
            .put_control(
                rainfall_store::KEY,
                &state.encode().unwrap(),
                &WriteCondition::Absent,
            )
            .await
            .unwrap();
        memory.0.lock().unwrap().state_puts = 0;
        let until = Instant::now() + Duration::from_secs(3);
        assert!(
            store.resolve(seed.clone(), &catalog, until).await.is_err(),
            "same local bytes do not prove imported membership"
        );
        assert!(store.activate(&state, &seed, until).await.is_err());
        assert_eq!(memory.0.lock().unwrap().state_puts, 0);
        let acquired = super::super::seed::acquisition(&p2_seed_bytes(0)).unwrap();
        let raw_key = acquired.records[0].envelope.identity.object_key().unwrap();
        catalog
            .publish(acquired.declaration, acquired.records, until)
            .await
            .unwrap();
        assert!(
            store
                .resolve(seed.clone(), &catalog, until)
                .await
                .unwrap()
                .is_some()
        );
        assert_eq!(
            memory.0.lock().unwrap().state_puts,
            0,
            "verify is read-only"
        );
        memory.0.lock().unwrap().raws.remove(&raw_key);
        assert!(store.resolve(seed.clone(), &catalog, until).await.is_err());
        assert!(store.activate(&state, &seed, until).await.is_err());
        assert_eq!(memory.0.lock().unwrap().state_puts, 0);
    }
    #[tokio::test]
    async fn p2_writer_cas_four_and_lost_response_never_resends() {
        for lost in [false, true] {
            let (memory, seed, state) = p2_fixture(false).await;
            let owner = p2_owner(memory.clone());
            memory.0.lock().unwrap().faults = if lost {
                std::collections::VecDeque::from([0])
            } else {
                std::collections::VecDeque::from([412, 412, 412, 412])
            };
            let until = Instant::now() + Duration::from_secs(3);
            let result = owner
                .offer(seed, Some(p2_current(&state, 0)), until, until)
                .await;
            if lost {
                assert!(result.unwrap().is_some());
                assert_eq!(memory.0.lock().unwrap().state_puts, 1);
            } else {
                assert!(matches!(result, Err(Error::Capacity)));
                assert_eq!(memory.0.lock().unwrap().state_puts, 4);
            }
            owner.quiesce();
            assert!(owner.drain(until).await);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn p2_original_reply_deadline_and_tightened_h_win_over_ready_result() {
        let now = Instant::now();
        let reply = Reply::new(now + Duration::from_secs(3));
        reply.tighten(now + Duration::from_secs(1));
        reply.finish(Ok(None));
        tokio::time::advance(Duration::from_secs(1)).await;
        assert!(
            matches!(
                reply.wait(now + Duration::from_secs(10)).await,
                Err(Error::Timeout)
            ),
            "a later caller cannot extend original intent/cohort H even when reply is ready"
        );
        let owner = owner();
        let state = p2_state(&p2_seed(0));
        let end = state.activation.first_end_ms;
        {
            let mut c = owner.coord.lock().unwrap();
            c.intents.insert(
                ([60, 127], end),
                Intent {
                    id: 1,
                    deadline: now + Duration::from_secs(2),
                    pending_input: true,
                    reply: Reply::new(now + Duration::from_secs(2)),
                },
            );
            c.intents.insert(
                ([98, 76], end),
                Intent {
                    id: 2,
                    deadline: now + Duration::from_secs(3),
                    pending_input: true,
                    reply: Reply::new(now + Duration::from_secs(3)),
                },
            );
        }
        let flight = owner
            .flight(&state, 2, end, now + Duration::from_secs(3), None)
            .await
            .unwrap();
        assert_eq!(
            flight.until,
            now + Duration::from_secs(2),
            "oldest live member anchors H, not creator scheduling"
        );
        let physical = flight.workspace.clone();
        tokio::time::advance(Duration::from_secs(1)).await;
        let later = tokio::spawn({
            let owner = owner.clone();
            async move {
                owner
                    .flight(&state, 3, end, now + Duration::from_secs(3), None)
                    .await
            }
        });
        tokio::task::yield_now().await;
        assert!(!later.is_finished());
        assert!(!flight.state.lock().unwrap().open);
        drop(flight);
        drop(physical);
        let later = later.await.unwrap().unwrap();
        assert_eq!(later.until, now + Duration::from_secs(3));
        owner.finish_intent(([60, 127], end), 1);
        owner.finish_intent(([98, 76], end), 2);
        owner.release_member(3);
        drop(later);
        owner.quiesce();
        assert!(owner.drain(now + Duration::from_secs(3)).await);
    }
    #[tokio::test]
    async fn p2_warm_no_current_reprobes_corrupt_and_pinned_absence_without_baseline() {
        let (memory, seed, _) = p2_fixture(false).await;
        let owner = p2_owner(memory.clone());
        let until = Instant::now() + Duration::from_secs(3);
        assert!(
            owner
                .offer(seed.clone(), None, until, until)
                .await
                .unwrap()
                .is_some()
        );
        memory
            .0
            .lock()
            .unwrap()
            .controls
            .get_mut(rainfall_store::KEY)
            .unwrap()
            .body = b"{".to_vec();
        assert!(matches!(
            owner.offer(seed.clone(), None, until, until).await,
            Err(Error::Corrupt(_))
        ));
        memory
            .0
            .lock()
            .unwrap()
            .controls
            .remove(rainfall_store::KEY);
        assert!(matches!(
            owner.offer(seed, None, until, until).await,
            Err(Error::Corrupt(_))
        ));
        assert_eq!(memory.0.lock().unwrap().state_puts, 0);
        owner.quiesce();
        assert!(owner.drain(until).await);
    }

    #[tokio::test]
    async fn p2_active_owned_decisions_complete_after_all_callers_cancel() {
        let (memory, seed, state) = p2_fixture(false).await;
        let owner = p2_owner(memory.clone());
        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        memory.0.lock().unwrap().probe_gate = Some((entered.clone(), release.clone()));
        let until = Instant::now() + Duration::from_secs(3);
        let mut callers = Vec::new();
        for grid in 0..2 {
            let owner = owner.clone();
            let seed = seed.clone();
            let current = p2_current(&state, grid);
            callers.push(tokio::spawn(async move {
                owner.offer(seed, Some(current), until, until).await
            }));
        }
        entered.notified().await;
        for _ in 0..10_000 {
            if owner.coord.lock().unwrap().intents.len() == 2 {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert_eq!(owner.coord.lock().unwrap().intents.len(), 2);
        for caller in callers {
            caller.abort();
            assert!(matches!(caller.await,Err(e) if e.is_cancelled()));
        }
        assert_eq!(owner.readers.available_permits(), 128);
        release.notify_one();
        owner.quiesce();
        assert!(owner.drain(until).await);
        assert_eq!(memory.0.lock().unwrap().state_puts, 2);
        assert_eq!(owner.parses.load(Ordering::SeqCst), 1);
        assert!(
            owner
                .pinned()
                .unwrap()
                .state
                .rows
                .iter()
                .all(|r| r.rns_count == Some(5.))
        );
    }
    #[tokio::test]
    async fn p2_delivery_ticket_is_retained_by_cloned_overlay_until_application_drop() {
        let (memory, seed, _) = p2_fixture(false).await;
        let owner = p2_owner(memory);
        let until = Instant::now() + Duration::from_secs(3);
        let overlay = owner
            .offer(seed, None, until, until)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(owner.readers.available_permits(), 127);
        let clone = overlay.clone();
        drop(overlay);
        assert_eq!(owner.readers.available_permits(), 127);
        drop(clone);
        assert_eq!(owner.readers.available_permits(), 128);
        owner.quiesce();
        assert!(owner.drain(until).await);
    }

    #[test]
    fn p2_actual_project_cancellation_retains_workspace_and_validator_until_blocking_exit() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .max_blocking_threads(1)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let (memory, seed, state) = p2_fixture(false).await;
            let owner = p2_owner(memory);
            let until = Instant::now() + Duration::from_secs(3);
            let current = p2_current(&state, 0);
            let mut plan = rainfall_input::validate(
                &owner.store.transport,
                &owner.inputs,
                &current,
                (owner.cutoff)().unwrap(),
                until,
                true,
            )
            .await
            .unwrap();
            let flight = owner
                .flight(&state, 1, current.end, until, None)
                .await
                .unwrap();
            let cursor = flight.cursor.clone();
            let guard = Arc::new((
                flight.workspace.clone(),
                cursor.clone().acquire_owned().await.unwrap(),
            ));
            let (release, wait) = std::sync::mpsc::channel();
            let (started, ready) = std::sync::mpsc::channel();
            let blocker = crate::observability::spawn_blocking(move || {
                started.send(()).unwrap();
                wait.recv().unwrap();
            });
            ready.recv_timeout(Duration::from_secs(1)).unwrap();
            let parsed = plan.project(
                vec![108., 159.],
                until,
                guard.clone(),
                flight.workspace.clone(),
            );
            drop(guard);
            assert!(
                timeout_at(Instant::now() + Duration::from_millis(10), parsed)
                    .await
                    .is_err()
            );
            owner.release_member(1);
            drop(flight);
            assert_eq!(
                cursor.available_permits(),
                0,
                "the queued ACTUAL project owns the validator"
            );
            assert!(
                !owner
                    .drain(Instant::now() + Duration::from_millis(10))
                    .await
            );
            release.send(()).unwrap();
            blocker.await.unwrap();
            assert!(owner.drain(until).await);
            assert_eq!(cursor.available_permits(), 1);
            assert_eq!(owner.running.available_permits(), 1);
            assert_eq!(seed.docs.len(), 2);
        });
    }

    // Review preparation only: this test uses the existing Owner::offer contract.
    #[tokio::test(start_paused = true)]
    async fn forty_no_current_absent_offers_all_receive_authoritative_baseline() {
        use std::{future::Future, task::Poll};
        let (owner, gate) = gated_owner();
        let outer = Instant::now() + Duration::from_secs(3);
        let ready_by = outer - Duration::from_millis(500);
        let seed = Arc::new(super::super::seed::embedded().clone());
        let mut pending: Vec<_> = (0..40)
            .map(|_| Some(Box::pin(owner.offer(seed.clone(), None, outer, ready_by))))
            .collect();
        let mut results = Vec::with_capacity(40);
        // This single poll pass executes admission in all forty original offer futures before
        // any spawned owner can run. It does not invent an API or advance the paused clock.
        std::future::poll_fn(|cx| {
            for future in &mut pending {
                if let Some(f) = future
                    && let Poll::Ready(answer) = f.as_mut().poll(cx)
                {
                    results.push(answer);
                    *future = None;
                }
            }
            Poll::Ready(())
        })
        .await;
        println!("review001 initial immediate answers={}", results.len());
        // Release each real existing gate read, including the baseline's serialized reads.
        // Finite cooperative polls avoid a sleep/timeout masquerading as the intended Red.
        for _ in 0..10_000 {
            gate.release.notify_one();
            tokio::task::yield_now().await;
            std::future::poll_fn(|cx| {
                for future in &mut pending {
                    if let Some(f) = future
                        && let Poll::Ready(answer) = f.as_mut().poll(cx)
                    {
                        results.push(answer);
                        *future = None;
                    }
                }
                Poll::Ready(())
            })
            .await;
            if results.len() == 40 {
                break;
            }
        }
        owner.quiesce();
        assert!(
            owner.drain(outer).await,
            "setup: all owned authority work must retire"
        );
        assert_eq!(
            results.len(),
            40,
            "setup: all forty existing API futures completed"
        );
        let baseline = results.iter().filter(|r| matches!(r, Ok(None))).count();
        let capacity = results
            .iter()
            .filter(|r| matches!(r, Err(Error::Capacity)))
            .count();
        println!(
            "review001 complete={} baseline={baseline} capacity={capacity} reads={}",
            results.len(),
            gate.reads.load(Ordering::SeqCst)
        );
        assert_eq!(
            baseline + capacity,
            40,
            "unexpected outcome: do not classify a timeout/transport/corrupt failure as the intended capacity Red"
        );
        assert_eq!(
            baseline, 40,
            "confirmed absent authority is baseline for every no-Current caller, independent of eight mutation slots"
        );
    }
}
