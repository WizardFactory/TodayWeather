//! Verification-only owner. One batch per source; retained until its whole trial is dropped.
//! This does not implement production overlay eviction, generation pins, retries or shutdown.
use futures_util::{StreamExt, stream};
use serde_json::{Value, json};
use server2::{
    gateway::BoxFuture,
    resolver::Acquisition,
    storage::{CatalogId, CatalogLimits, CatalogStore, CatalogTransport, Error, RawRecord, sha256},
};
use std::sync::{Arc, Mutex};
use tokio::{
    sync::{OwnedSemaphorePermit, Semaphore, TryAcquireError, watch},
    task::JoinHandle,
    time::{Duration, Instant},
};

pub type Timeline = Arc<Mutex<Vec<Value>>>;
pub fn event(log: &Timeline, start: Instant, name: &str) {
    log.lock()
        .unwrap()
        .push(json!({"event":name,"ms":start.elapsed().as_secs_f64()*1000.}));
}

/// Complete pure validation confers RAM visibility, never S3 eligibility.
#[derive(Clone)]
pub struct Validated {
    pub name: String,
    acquisition: Arc<Acquisition>,
}
impl Validated {
    pub fn new(name: String, acquisition: Acquisition) -> Result<Self, Error> {
        let limits = CatalogLimits::default();
        acquisition
            .declaration
            .attach(acquisition.records.clone(), &limits)?;
        for r in &acquisition.records {
            if r.bytes.len() != r.envelope.raw_length
                || sha256(&r.bytes) != r.envelope.identity.raw_sha256
            {
                return Err(Error::Invalid("measurement raw identity"));
            }
        }
        Ok(Self {
            name,
            acquisition: Arc::new(acquisition),
        })
    }
    pub fn records(&self) -> &[RawRecord] {
        &self.acquisition.records
    }
    pub fn catalog(&self) -> CatalogId {
        self.acquisition.declaration.partitions[0].clone()
    }
}

pub struct Captured {
    pub groups: Vec<Validated>,
    pub jobs: Vec<Value>,
}
pub type Work = BoxFuture<'static, Captured>;
pub fn reservation_bytes() -> usize {
    31 * super::scope::RESPONSE + 7 * CatalogLimits::default().control_bytes
}
pub fn capacity() -> Arc<Semaphore> {
    Arc::new(Semaphore::new(reservation_bytes()))
}
type Ready = Option<Result<Arc<Vec<Validated>>, String>>;
pub struct Pending {
    work: Mutex<Option<Work>>,
    ready: watch::Sender<Ready>,
    release: watch::Sender<bool>,
    owner: Mutex<Option<JoinHandle<Value>>>,
    pub log: Timeline,
    pub start: Instant,
    durable_first: bool,
    reservation: Arc<OwnedSemaphorePermit>,
}
impl Pending {
    pub fn new(
        work: Work,
        durable_first: bool,
        capacity: Arc<Semaphore>,
    ) -> Result<Arc<Self>, TryAcquireError> {
        // Admission fails before provider work can be polled. All live trials share this pool.
        let reservation = Arc::new(capacity.try_acquire_many_owned(reservation_bytes() as u32)?);
        Ok(Arc::new(Self {
            work: Mutex::new(Some(work)),
            ready: watch::channel(None).0,
            release: watch::channel(false).0,
            owner: Mutex::new(None),
            log: Arc::new(Mutex::new(Vec::new())),
            start: Instant::now(),
            durable_first,
            reservation,
        }))
    }
    pub fn start<T: CatalogTransport + Clone>(&self, store: Arc<CatalogStore<T>>) {
        let Some(work) = self.work.lock().unwrap().take() else {
            return;
        };
        let ready = self.ready.clone();
        let mut release = self.release.subscribe();
        let log = self.log.clone();
        let start = self.start;
        let durable_first = self.durable_first;
        let reservation = self.reservation.clone();
        let task = tokio::spawn(async move {
            let _reservation = reservation;
            // Reserved before polling any provider work: six maximum-five-page products
            // plus RSS, each bounded by the transport's 8 MiB response cap. Trials are serial.
            let reserved_raw_bytes = 31 * super::scope::RESPONSE;
            event(&log, start, "raw_capacity_reserved_before_provider");
            let captured = work.await;
            let retained: usize = captured
                .groups
                .iter()
                .flat_map(|g| g.records())
                .map(|r| r.bytes.len())
                .sum();
            // Ownership is already in this supervised task before Ready is broadcast.
            let groups = Arc::new(captured.groups);
            event(&log, start, "validated_writer_owned");
            let publish = || async {
                event(&log, start, "canonical_publication_started");
                stream::iter(groups.iter().cloned()).map(|g| {
                    let store = store.clone();
                    async move {
                        let t = Instant::now();
                        let a = &g.acquisition;
                        let result = store.publish(a.declaration.clone(), a.records.clone(), Instant::now()+Duration::from_secs(10)).await;
                        json!({"name":g.name,"durable":result.is_ok(),"ms":t.elapsed().as_secs_f64()*1000.,"error":result.err().map(|e|e.to_string())})
                    }
                }).buffer_unordered(4).collect::<Vec<_>>().await
            };
            let publications;
            let mut gate = "durable_first";
            if durable_first {
                publications = publish().await;
                if publications.iter().all(|v| v["durable"] == true) {
                    ready.send_replace(Some(Ok(groups.clone())));
                } else {
                    ready.send_replace(Some(Err("durable control publication failed".into())));
                }
                event(&log, start, "ram_ready");
            } else {
                ready.send_replace(Some(Ok(groups.clone())));
                event(&log, start, "ram_ready");
                let wait = async {
                    while !*release.borrow_and_update() {
                        if release.changed().await.is_err() {
                            break;
                        }
                    }
                };
                gate = if tokio::time::timeout(Duration::from_secs(15), wait)
                    .await
                    .is_ok()
                {
                    "test_client_terminal"
                } else {
                    "dormancy_cap"
                };
                event(&log, start, gate);
                publications = publish().await;
            }
            event(&log, start, "canonical_publication_finished");
            json!({"jobs":captured.jobs,"publications":publications,"release_reason":gate,
                "reserved_raw_bytes":reserved_raw_bytes,"retained_raw_bytes":retained,
                "raw_within_reservation":retained<=reserved_raw_bytes,
                "metadata_reservation_bytes":7*CatalogLimits::default().control_bytes,
                "prototype_single_batch_retained_until_trial_drop":true})
        });
        *self.owner.lock().unwrap() = Some(task);
    }
    pub async fn ready(&self) -> Result<Arc<Vec<Validated>>, String> {
        let mut rx = self.ready.subscribe();
        loop {
            if let Some(v) = rx.borrow_and_update().clone() {
                return v;
            }
            rx.changed().await.map_err(|_| "owner stopped".to_owned())?;
        }
    }
    pub fn release(&self) {
        self.release.send_replace(true);
    }
    pub async fn drain(&self) -> Value {
        let task = self.owner.lock().unwrap().take();
        match task {
            Some(t) => match t.await {
                Ok(v) => v,
                Err(_) => json!({"owner_error":true}),
            },
            None => json!({"owner_not_started":true}),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use server2::storage::{GroupDeclaration, GroupMember, Limits, Period, ProviderKey};
    fn acquisition() -> Acquisition {
        let r = RawRecord::new(
            "kma",
            "test",
            &ProviderKey::Grid { nx: 60, ny: 127 },
            Period {
                local_date: 20261024,
                slot: "1200".into(),
            },
            1,
            200,
            "application/json",
            None,
            Arc::from(&b"{}"[..]),
            &Limits::default(),
        )
        .unwrap();
        let c = CatalogId::for_record(&r.envelope.identity, "20261024-1200").unwrap();
        let d = GroupDeclaration::new(
            vec![GroupMember {
                envelope: r.envelope.clone(),
                catalogs: vec![c],
            }],
            &CatalogLimits::default(),
        )
        .unwrap();
        Acquisition {
            declaration: d,
            records: vec![r],
        }
    }
    #[test]
    fn pure_validation_rejects_changed_raw_and_missing_pages() {
        let mut a = acquisition();
        a.records[0].bytes = Arc::from(&b"[]"[..]);
        assert!(Validated::new("x".into(), a).is_err());
        let mut a = acquisition();
        a.records.clear();
        assert!(Validated::new("x".into(), a).is_err());
    }
    #[test]
    fn validation_keeps_original_envelope_and_arc_body() {
        let a = acquisition();
        let body = a.records[0].bytes.clone();
        let v = Validated::new("x".into(), a).unwrap();
        assert!(v.records()[0].envelope.fetch_group.is_none());
        assert!(Arc::ptr_eq(&body, &v.records()[0].bytes));
    }

    fn one_group() -> Work {
        Box::pin(async {
            Captured {
                groups: vec![Validated::new("x".into(), acquisition()).unwrap()],
                jobs: vec![],
            }
        })
    }
    fn read_only_store() -> Arc<CatalogStore<super::super::source::Empty>> {
        Arc::new(CatalogStore::new(super::super::source::Empty, CatalogLimits::default()).unwrap())
    }
    #[tokio::test]
    async fn cancelled_waiter_keeps_raw_and_publication_waits_for_terminal() {
        let owner = Pending::new(one_group(), false, capacity()).unwrap();
        owner.start(read_only_store());
        let waiter = {
            let owner = owner.clone();
            tokio::spawn(async move { owner.ready().await })
        };
        waiter.abort();
        let ready = owner.ready().await.unwrap();
        assert_eq!(&*ready[0].records()[0].bytes, b"{}");
        assert!(
            !owner
                .log
                .lock()
                .unwrap()
                .iter()
                .any(|e| e["event"] == "canonical_publication_started")
        );
        owner.release();
        let result = owner.drain().await;
        assert_eq!(result["release_reason"], "test_client_terminal");
        assert_eq!(result["publications"][0]["durable"], false);
        // A failed publication never changes the original RAM envelope into a durable input.
        assert!(
            owner.ready().await.unwrap()[0].records()[0]
                .envelope
                .fetch_group
                .is_none()
        );
    }
    #[tokio::test(start_paused = true)]
    async fn missing_client_terminal_has_a_hard_cap() {
        let owner = Pending::new(one_group(), false, capacity()).unwrap();
        owner.start(read_only_store());
        owner.ready().await.unwrap();
        tokio::time::advance(Duration::from_secs(16)).await;
        assert_eq!(owner.drain().await["release_reason"], "dormancy_cap");
    }
    #[tokio::test]
    async fn durable_control_never_serves_failed_publication() {
        let owner = Pending::new(one_group(), true, capacity()).unwrap();
        owner.start(read_only_store());
        assert!(owner.ready().await.is_err());
        assert_eq!(owner.drain().await["publications"][0]["durable"], false);
    }
    #[test]
    fn pressure_rejects_new_work_before_polling_and_releases_after_owner_drop() {
        let pool = capacity();
        let first = Pending::new(one_group(), false, pool.clone()).unwrap();
        assert!(Pending::new(one_group(), false, pool.clone()).is_err());
        drop(first);
        assert!(Pending::new(one_group(), false, pool).is_ok());
    }
}
