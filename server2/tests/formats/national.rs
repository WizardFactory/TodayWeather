//! S13d (#2747): a national AirKorea dataset is one owned acquisition keyed by dataset and
//! publication, shared by requests from every cell. A provider slower than the 3-second waiter
//! leaves those requests without the section (legacy absent-data output); the owned acquisition
//! keeps the legacy 5-second AirKorea timeout, publishes the raw record to S3, and the next
//! request reads it with no further provider call.
use super::common::*;
use super::smoke::Peer;
use super::support::*;
use server2::domestic::airkorea::AirKoreaRequest;
use server2::domestic::family::{Service, owned_provider_time};
use server2::resolver::{OwnedConfig, OwnedFlights, WAITER_BOUND, Waited};
use server2::storage::{CatalogId, CatalogLimits, CatalogStore, LookupOutcome, ProviderKey};
use std::{sync::Arc, time::Duration};
use tokio::time::Instant;

type Key = (&'static str, u32);

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn national_station_list_is_acquired_once_for_many_cells() {
    let e = Arc::new(env().await);
    let peer = Peer::new();
    let body = local("airkorea-station-list.json");
    // Slower than the request waiter, faster than the legacy 5-second AirKorea timeout.
    e.stub
        .push(STATION_LIST, Reply::json(body.clone()).delayed(4_000));
    let store = Arc::new(CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap());
    let flights: OwnedFlights<Key, Result<(), String>> =
        OwnedFlights::new(OwnedConfig::default()).unwrap();
    // Two legacy attempts plus a publication allowance.
    let owned_for =
        owned_provider_time(Service::AirKorea.attempt_timeout(), 1) + Duration::from_secs(3);
    let key: Key = ("airkorea-station-list", 20261013);
    let started = Instant::now();
    let requests: Vec<_> = (0..24)
        .map(|_| {
            let (flights, e, store) = (flights.clone(), e.clone(), store.clone());
            tokio::spawn(async move {
                flights
                    .join(
                        key,
                        Instant::now() + Duration::from_secs(9),
                        owned_for,
                        move |owner_deadline| async move {
                            let outcome = e
                                .acquirer
                                .acquire_airkorea(&AirKoreaRequest::station_list(), owner_deadline)
                                .await;
                            let a = match outcome {
                                Ok(server2::domestic::Acquired::Complete(a)) => a,
                                other => return Err(format!("{other:?}")),
                            };
                            store
                                .publish(a.declaration, a.records, owner_deadline)
                                .await
                                .map(|_| ())
                                .map_err(|e| format!("{e:?}"))
                        },
                    )
                    .await
            })
        })
        .collect();
    for r in requests {
        // Each request answers without this section within the waiter bound.
        assert!(matches!(r.await.unwrap(), Waited::Pending { .. }));
    }
    assert!(started.elapsed() < WAITER_BOUND + Duration::from_millis(500));
    tokio::time::timeout(Duration::from_secs(10), async {
        while flights.running() != 0 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(e.stub.calls().len(), 1, "one national provider call");
    // The next request reads the stored record from S3 with empty memory.
    let stations = ProviderKey::Named {
        id: "stations".into(),
    };
    let id = CatalogId {
        source: "data-go-kr".into(),
        kind: "airkorea-station-list".into(),
        key_sha256: server2::storage::sha256(&stations.canonical_bytes().unwrap()),
        partition: "20261013".into(),
    };
    let cold = CatalogStore::new(peer.transport(), CatalogLimits::default()).unwrap();
    let set = match cold.lookup(&id, deadline()).await.unwrap() {
        LookupOutcome::Ready(set) => set,
        LookupOutcome::Incomplete => panic!("published group is incomplete"),
    };
    assert_eq!(&set.acquisitions()[0].records()[0].bytes[..], &body[..]);
    assert_eq!(e.stub.calls().len(), 1);
}
