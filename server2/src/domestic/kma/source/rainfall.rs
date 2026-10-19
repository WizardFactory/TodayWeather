//! One cancellation-safe source owner for schema1 cumulative rainfall decisions.
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
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;
use tokio::{
    sync::{Semaphore, oneshot},
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
}
#[derive(Clone)]
struct Pinned {
    seed: Arc<StationSeed>,
    epoch: String,
    acknowledged_revision: u64,
    first_seen_at: f64,
}
pub struct Owner<T> {
    store: Store<T>,
    inputs: Arc<CatalogStore<T>>,
    clock: Clock,
    accepting: AtomicBool,
    offers: Arc<Semaphore>,
    running: Arc<Semaphore>,
    pinned: Mutex<Option<Pinned>>,
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
            pinned: Mutex::new(None),
        }))
    }
    pub(super) async fn offer(
        self: &Arc<Self>,
        seed: Arc<StationSeed>,
        current: Option<Current>,
        outer_deadline: Instant,
        caller_ready_by: Instant,
    ) -> Result<Option<Overlay>, Error> {
        if !self.accepting.load(Ordering::SeqCst) {
            return Err(Error::Capacity);
        }
        // Admission keeps its existing outer guard. The caller separately shares Source's
        // answer boundary; neither cutoff changes the accepted owner's original three seconds.
        let admission_until = outer_deadline
            .checked_sub(Duration::from_millis(10))
            .filter(|until| *until > Instant::now())
            .ok_or(Error::Timeout)?;
        let wait_until = caller_ready_by.min(admission_until);
        let queued = self
            .offers
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::Capacity)?;
        let owned_deadline = Instant::now() + Duration::from_secs(3);
        let this = self.clone();
        let (tx, rx) = oneshot::channel();
        // Spawn before awaiting the HTTP waiter. Its cancellation cannot abort admission, work,
        // conditional write, or readback. One running reservation also owns parse scratch.
        crate::observability::spawn(async move {
            let _queued = queued;
            let result = async {
                let guard = Arc::new(
                    timeout_at(owned_deadline, this.running.clone().acquire_owned())
                        .await
                        .map_err(|_| Error::Timeout)?
                        .map_err(|_| Error::Capacity)?,
                );
                if !this.accepting.load(Ordering::SeqCst) {
                    return Err(Error::Capacity);
                }
                let until = owned_deadline;
                timeout_at(until, this.work(seed, current, guard, until))
                    .await
                    .map_err(|_| Error::Timeout)?
            }
            .await;
            let _ = tx.send(result);
        });
        // Expired caller readiness must not starve independently admitted owned work.
        if Instant::now() >= wait_until {
            return Err(Error::Timeout);
        }
        let answer = timeout_at(wait_until, rx).await;
        // Timeout wins even when Tokio polls an already-ready reply before its expired timer.
        // Check before inspecting any result so an unknown result cannot become baseline/ack.
        if Instant::now() >= wait_until {
            return Err(Error::Timeout);
        }
        answer
            .map_err(|_| Error::Timeout)?
            .map_err(|_| Error::Transport)?
    }
    fn pinned(&self) -> Option<Pinned> {
        self.pinned
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
    fn acknowledge(&self, state: Checkpoint, seed: Arc<StationSeed>) -> Result<Overlay, Error> {
        let now = (self.clock)();
        if !now.is_finite() {
            return Err(Error::Invalid("rainfall acknowledged clock"));
        }
        let mut pinned = self.pinned.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(old) = pinned.as_mut() {
            if old.epoch != state.activation.epoch || old.seed.body_sha256 != seed.body_sha256 {
                return Err(Error::Corrupt("rainfall changed epoch"));
            }
            if old.acknowledged_revision != state.revision {
                old.acknowledged_revision = state.revision;
                old.first_seen_at = now;
            }
        } else {
            *pinned = Some(Pinned {
                seed: seed.clone(),
                epoch: state.activation.epoch.clone(),
                acknowledged_revision: state.revision,
                first_seen_at: now,
            });
        }
        let since = pinned
            .as_ref()
            .expect("acknowledged pin exists")
            .first_seen_at;
        Ok(Overlay {
            state: Arc::new(state),
            seed,
            since,
        })
    }
    async fn read(
        &self,
        seed: &StationSeed,
        deadline: Instant,
    ) -> Result<Option<(Checkpoint, crate::storage::ControlObject)>, Error> {
        let read = self.store.read(seed, deadline).await?;
        if let Some(pin) = self.pinned() {
            match &read {
                Some((s, _)) if s.activation.epoch == pin.epoch => (),
                _ => {
                    return Err(Error::Corrupt(
                        "rainfall authority disappeared/changed epoch",
                    ));
                }
            }
        }
        Ok(read)
    }
    async fn work(
        &self,
        seed: Arc<StationSeed>,
        current: Option<Current>,
        guard: Arc<tokio::sync::OwnedSemaphorePermit>,
        deadline: Instant,
    ) -> Result<Option<Overlay>, Error> {
        let cutoff = u64::try_from(
            crate::budget::Clock::now_ms(&crate::budget::SystemClock)
                .map_err(|_| Error::Invalid("rainfall clock"))?,
        )
        .map_err(|_| Error::Invalid("rainfall clock"))?;
        let pinned = self.pinned();
        let candidate = pinned.as_ref().map_or(seed, |p| p.seed.clone());
        let Some((state, _, seed)) = self
            .store
            .resolve(candidate, &self.inputs, deadline)
            .await?
        else {
            if pinned.is_some() {
                return Err(Error::Corrupt("rainfall authority disappeared"));
            }
            return Ok(None);
        };
        if pinned
            .as_ref()
            .is_some_and(|p| p.epoch != state.activation.epoch)
        {
            return Err(Error::Corrupt("rainfall changed epoch"));
        }
        // This valid acknowledged binding pins the exact seed even when the window cannot qualify.
        self.acknowledge(state.clone(), seed.clone())?;
        let Some(current) = current else {
            return self.acknowledge(state, seed).map(Some);
        };
        let commit_clock = (self.clock)();
        if !commit_clock.is_finite()
            || commit_clock < state.activation.shutdown_at_ms as f64
            || cutoff < state.activation.shutdown_at_ms
        {
            return Err(Error::Invalid("rainfall shutdown clock"));
        }
        if current.end < state.activation.first_end_ms || !(current.pty > 0. || current.rn1 > 0.) {
            return self.acknowledge(state, seed).map(Some);
        }
        let mut candidates: Vec<_> = seed
            .docs
            .iter()
            .zip(&seed.identities)
            .filter_map(|(d, oid)| {
                let oid = (*oid)?;
                let geo = d.get("geo")?;
                let Val::Arr(g) = geo else { return None };
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
        candidates.sort_by_key(|(id, _)| *id);
        if !candidates.iter().any(|(id, _)| {
            state
                .rows
                .iter()
                .any(|r| r.oid == *id && r.last_end_ms.is_none_or(|end| end < current.end))
        }) {
            return self.acknowledge(state, seed).map(Some);
        }
        let mut sensors = Vec::new();
        for (_, id) in &candidates {
            if !sensors.contains(id) {
                sensors.push(*id);
            }
        }
        let minutes = match rainfall_input::read(
            &self.store.transport,
            &self.inputs,
            &current,
            sensors,
            cutoff,
            deadline,
            guard.clone(),
        )
        .await
        {
            MinuteResult::Ready(v) => v,
            MinuteResult::NotEligible => return self.acknowledge(state, seed).map(Some),
            MinuteResult::Incomplete => {
                return Err(Error::Corrupt("rainfall incomplete minute view"));
            }
            MinuteResult::Unavailable => return Err(Error::Transport),
        };
        for _ in 0..4 {
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
            match self.store.put(&bytes, &object.etag, deadline).await {
                Ok(200) => return self.acknowledge(acknowledged, seed).map(Some),
                Ok(412) => continue,
                Ok(status) if (400..500).contains(&status) && status != 409 => {
                    return Err(Error::Status(status));
                }
                _ => {
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
                if self.offers.available_permits() == 8 && self.running.available_permits() == 1 {
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
mod tests {
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
                owner.running.available_permits(),
                0,
                "caller timeout cannot cancel accepted authority read"
            );
            assert_eq!(owner.offers.available_permits(), 7);
            gate.release.notify_one();
            while owner.offers.available_permits() != 8 {
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
                owner.offers.available_permits(),
                7,
                "exactly one owned offer remains admitted"
            );
            gate.entered.notified().await;
            assert_eq!(gate.reads.load(Ordering::SeqCst), 1);
            assert_eq!(owner.running.available_permits(), 0);
            gate.release.notify_one();
            while owner.offers.available_permits() != 8 {
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
        while owner.offers.available_permits() != 8 {
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
        while owner.offers.available_permits() != 8 {
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
        let source = owner.clone();
        let offer = tokio::spawn(async move {
            source
                .offer(
                    Arc::new(super::super::seed::embedded().clone()),
                    None,
                    Instant::now() + Duration::from_secs(10),
                    Instant::now() + Duration::from_secs(10),
                )
                .await
        });
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(4)).await;
        assert!(
            matches!(offer.await.unwrap(), Err(Error::Timeout)),
            "queued owner must expire without starting a fresh3seconds or reaching S3"
        );
        drop(held);
        owner.quiesce();
        assert!(owner.drain(Instant::now() + Duration::from_secs(1)).await);
        assert!(matches!(
            owner
                .offer(
                    Arc::new(super::super::seed::embedded().clone()),
                    None,
                    Instant::now() + Duration::from_secs(1),
                    Instant::now() + Duration::from_secs(1),
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
}
