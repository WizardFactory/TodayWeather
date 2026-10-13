use super::geocode::{config, fixture, service, stub};
use server2::geocode::{
    AddressProjection, AddressStore, BoxFuture, GeoClient, GeocodeError, Geocoder, GeocoderConfig,
    MockQuota,
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
async fn activation_live_provider_quota_is_fail_closed_even_with_mock_funding() {
    let geo = Geocoder::new(GeocoderConfig::default())
        .unwrap()
        .with_quota(Arc::new(MockQuota::new(1000)));
    assert!(matches!(
        geo.coord([40.748, -73.985], "en").await,
        Err(GeocodeError::Quota)
    ));
}
#[test]
fn activation_mock_requires_explicit_literal_loopback_urls() {
    for url in [
        "http://localhost:9999",
        "http://127.1:9999",
        "http://2130706433:9999",
        "http://127.0.0.1.example:9999",
        "https://127.0.0.1:9999",
        "http://127.0.0.1:9999?key=x",
        "http://127.0.0.1:9999/escape",
        "http://user@127.0.0.1:9999",
    ] {
        let options = GeocoderConfig {
            mock_mode: true,
            kakao_base_url: url.into(),
            google_base_url: url.into(),
            ..GeocoderConfig::default()
        };
        assert!(Geocoder::new(options).is_err(), "{url}");
    }
    let options = GeocoderConfig {
        mock_mode: true,
        kakao_base_url: "http://[::1]:9999".into(),
        google_base_url: "http://[::1]:9999".into(),
        ..GeocoderConfig::default()
    };
    assert!(Geocoder::new(options).is_ok());
}
#[tokio::test]
async fn activation_quota_reservation_denies_before_any_provider_request() {
    let peer = stub(vec![], vec![]).await;
    let geo = Geocoder::new(config(&peer))
        .unwrap()
        .with_quota(Arc::new(MockQuota::new(0)));
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
