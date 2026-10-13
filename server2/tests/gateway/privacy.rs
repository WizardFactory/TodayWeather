use super::geocode::{config, fixture, service, stub};
use super::runtime::CountingQuota;
use server2::geocode::{
    AddressProjection, AddressStore, BoxFuture, GeoClient, GeocodeError, Geocoder, GeocoderConfig,
};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

#[derive(Default)]
struct AddressRecorder {
    gets: AtomicUsize,
    puts: AtomicUsize,
    saved: Mutex<Option<AddressProjection>>,
    fail_put: bool,
}
impl AddressStore for AddressRecorder {
    fn get<'a>(
        &'a self,
        _: &'a str,
    ) -> BoxFuture<'a, Result<Option<AddressProjection>, GeocodeError>> {
        self.gets.fetch_add(1, Ordering::AcqRel);
        Box::pin(async { Ok(self.saved.lock().unwrap().clone()) })
    }
    fn put<'a>(
        &'a self,
        _: &'a str,
        value: &'a AddressProjection,
    ) -> BoxFuture<'a, Result<(), GeocodeError>> {
        self.puts.fetch_add(1, Ordering::AcqRel);
        Box::pin(async move {
            if self.fail_put {
                Err(GeocodeError::Provider)
            } else {
                *self.saved.lock().unwrap() = Some(value.clone());
                Ok(())
            }
        })
    }
}
#[tokio::test]
async fn privacy_reverse_lookup_never_invokes_address_persistence() {
    let peer = stub(
        vec![(200, fixture("kakao.coord.seoul"), Duration::ZERO)],
        vec![],
    )
    .await;
    let store = Arc::new(AddressRecorder::default());
    let geo = service(&peer).with_address_store(store.clone());
    assert!(geo.coord([37.566, 126.978], "ko").await.is_ok());
    assert_eq!(store.gets.load(Ordering::Acquire), 0);
    assert_eq!(store.puts.load(Ordering::Acquire), 0);
}
#[tokio::test]
async fn privacy_only_address_projection_can_persist_and_restore() {
    let peer = stub(
        vec![],
        vec![(200, fixture("google.addr.nocountry"), Duration::ZERO)],
    )
    .await;
    let store = Arc::new(AddressRecorder::default());
    let geo = service(&peer).with_address_store(store.clone());
    let first = geo.addr("Somewhere", "en").await.unwrap();
    assert_eq!(store.puts.load(Ordering::Acquire), 1);
    let second = service(&peer)
        .with_address_store(store.clone())
        .addr("Somewhere", "ko")
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_vec(&first).unwrap(),
        serde_json::to_vec(&second).unwrap()
    );
    assert_eq!(peer.state.count.load(Ordering::Acquire), 1);
    assert!(
        store
            .saved
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .geo
            .kma_address
            .is_none()
    );
}
#[tokio::test]
async fn privacy_failed_address_publication_does_not_create_success_cache() {
    let peer = stub(
        vec![],
        vec![
            (200, fixture("google.addr.nocountry"), Duration::ZERO),
            (200, fixture("google.addr.nocountry"), Duration::ZERO),
        ],
    )
    .await;
    let store = Arc::new(AddressRecorder {
        fail_put: true,
        ..AddressRecorder::default()
    });
    let geo = service(&peer).with_address_store(store.clone());
    for _ in 0..2 {
        assert!(matches!(
            geo.addr("Somewhere", "en").await,
            Err(GeocodeError::Provider)
        ));
    }
    assert_eq!(peer.state.count.load(Ordering::Acquire), 2);
    assert_eq!(geo.cache_bytes(), 0);
}
#[tokio::test]
async fn privacy_expired_corrupt_or_mismatched_address_projection_is_a_miss() {
    let peer = stub(
        vec![],
        vec![(200, fixture("google.addr.nocountry"), Duration::ZERO)],
    )
    .await;
    let store = Arc::new(AddressRecorder::default());
    *store.saved.lock().unwrap() = Some(AddressProjection {
        geo: GeoClient {
            address: Some("Other address".into()),
            ..GeoClient::default()
        },
        updated_unix_ms: 1,
    });
    assert!(
        service(&peer)
            .with_address_store(store)
            .addr("Somewhere", "en")
            .await
            .is_ok()
    );
    assert_eq!(peer.state.count.load(Ordering::Acquire), 1);
}
#[tokio::test]
async fn activation_without_a_configured_quota_is_fail_closed() {
    let peer = stub(vec![], vec![]).await;
    let geo = Geocoder::new(config(&peer)).unwrap();
    assert!(matches!(
        geo.coord([40.748, -73.985], "en").await,
        Err(GeocodeError::Quota)
    ));
    assert_eq!(peer.state.count.load(Ordering::Acquire), 0);
}
#[test]
fn configured_endpoints_follow_the_transport_rule() {
    for url in [
        "http://localhost:9999",
        "http://10.0.0.5:9999",
        "http://geocode.example.test",
        "ftp://127.0.0.1:9999",
        "http://127.0.0.1:9999?key=x",
        "http://127.0.0.1:9999/escape",
        "https://dapi.kakao.com/v2",
        "http://user@127.0.0.1:9999",
        "not a url",
    ] {
        let options = GeocoderConfig {
            kakao_base_url: url.into(),
            ..GeocoderConfig::default()
        };
        assert!(Geocoder::new(options).is_err(), "{url}");
    }
    for url in [
        "https://dapi.kakao.com",
        "https://geocode.example.test/",
        "https://127.0.0.1:9999",
        "http://127.0.0.1:9999",
        "http://[::1]:9999",
    ] {
        let options = GeocoderConfig {
            kakao_base_url: url.into(),
            google_base_url: url.into(),
            ..GeocoderConfig::default()
        };
        assert!(Geocoder::new(options).is_ok(), "{url}");
    }
}
#[test]
fn google_key_fingerprint_applies_to_the_production_endpoint() {
    let vars = |base: Option<&'static str>| {
        move |name: &str| match name {
            "GEOCODER_GOOGLE_KEY" => Some("synthetic-google-key".to_owned()),
            "GEOCODER_GOOGLE_BASE_URL" => base.map(str::to_owned),
            _ => None,
        }
    };
    // Default (production) endpoint: a key with another fingerprint is not used (legacy rule).
    let production = GeocoderConfig::from_vars(&vars(None)).unwrap();
    assert_eq!(production.google_base_url, "https://maps.googleapis.com");
    assert!(production.google_key.is_none());
    // A configured test endpoint keeps the configured key, as legacy does for its stub.
    let test = GeocoderConfig::from_vars(&vars(Some("http://127.0.0.1:9/"))).unwrap();
    assert_eq!(test.google_base_url, "http://127.0.0.1:9");
    assert_eq!(test.google_key.as_deref(), Some("synthetic-google-key"));
}
#[tokio::test]
async fn activation_quota_reservation_denies_before_any_provider_request() {
    let peer = stub(vec![], vec![]).await;
    let geo = Geocoder::new(config(&peer))
        .unwrap()
        .with_quota(Arc::new(CountingQuota::new(0)));
    assert!(matches!(
        geo.coord([37.566, 126.978], "ko").await,
        Err(GeocodeError::Quota)
    ));
    assert_eq!(peer.state.count.load(Ordering::Acquire), 0);
}
#[test]
fn privacy_error_text_contains_no_query_key_or_coordinate() {
    for error in [
        GeocodeError::Provider,
        GeocodeError::Capacity,
        GeocodeError::InvalidConfiguration,
        GeocodeError::Quota,
    ] {
        assert!(!error.to_string().contains("http"));
        assert!(!format!("{error:?}").contains("37.566"));
    }
}

#[tokio::test]
async fn review006_panicking_address_store_does_not_poison_address_flight() {
    struct PanicStore(AtomicUsize);
    impl AddressStore for PanicStore {
        fn get<'a>(
            &'a self,
            _: &'a str,
        ) -> BoxFuture<'a, Result<Option<AddressProjection>, GeocodeError>> {
            Box::pin(async move {
                if self.0.fetch_add(1, Ordering::AcqRel) == 0 {
                    panic!("injected address store panic");
                }
                Ok(None)
            })
        }
        fn put<'a>(
            &'a self,
            _: &'a str,
            _: &'a AddressProjection,
        ) -> BoxFuture<'a, Result<(), GeocodeError>> {
            Box::pin(async { Ok(()) })
        }
    }
    let peer = stub(
        vec![],
        vec![(200, fixture("google.addr.nocountry"), Duration::ZERO)],
    )
    .await;
    let store = Arc::new(PanicStore(AtomicUsize::new(0)));
    let geo = service(&peer).with_address_store(store.clone());
    assert!(matches!(
        geo.addr("Somewhere", "en").await,
        Err(GeocodeError::Provider)
    ));
    assert!(geo.addr("Somewhere", "en").await.is_ok());
    assert_eq!(store.0.load(Ordering::Acquire), 2);
    assert_eq!(geo.active_owners(), 0);
}
