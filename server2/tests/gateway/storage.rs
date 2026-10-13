use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::any,
};
use server2::{
    geocode::storage::S3AddressStore,
    geocode::{AddressProjection, AddressStore, GeoClient},
    storage::HttpS3Transport,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
#[derive(Default)]
struct Data {
    objects: BTreeMap<String, Vec<u8>>,
    puts: usize,
    fail: bool,
    corrupt_after_write: bool,
}
async fn handler(State(data): State<Arc<Mutex<Data>>>, r: Request) -> Response {
    let key = r.uri().path().to_owned();
    if r.method() == "PUT" {
        let bytes = to_bytes(r.into_body(), 32768).await.unwrap().to_vec();
        let mut d = data.lock().unwrap();
        d.puts += 1;
        if d.fail {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
        let bytes = if d.corrupt_after_write {
            b"corrupt".to_vec()
        } else {
            bytes
        };
        d.objects.insert(key, bytes);
        StatusCode::OK.into_response()
    } else {
        let d = data.lock().unwrap();
        match d.objects.get(&key) {
            Some(v) => (
                [("content-type", "application/json")],
                Body::from(v.clone()),
            )
                .into_response(),
            None => StatusCode::NOT_FOUND.into_response(),
        }
    }
}
fn projection() -> AddressProjection {
    let geo: GeoClient = serde_json::from_str(
        r#"{"address":"서울","country":"KR","location":{"lat":37.566,"long":126.978}}"#,
    )
    .unwrap();
    AddressProjection {
        geo,
        updated_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
    }
}
#[tokio::test]
async fn address_projection_roundtrip_expiry_corruption_and_publication_failure() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let data = Arc::new(Mutex::new(Data::default()));
    let app = Router::new()
        .fallback(any(handler))
        .with_state(data.clone());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let store = S3AddressStore::new(Arc::new(
        HttpS3Transport::new(
            &endpoint,
            "server2-s10",
            "ap-northeast-2",
            rusty_s3::Credentials::new("dummy", "dummy"),
        )
        .unwrap(),
    ));
    assert!(store.get("서울").await.unwrap().is_none());
    let p = projection();
    store.put("서울", &p).await.unwrap();
    let restored = store.get("서울").await.unwrap().unwrap();
    assert_eq!(
        serde_json::to_vec(&p).unwrap(),
        serde_json::to_vec(&restored).unwrap()
    );
    assert!(store.put("37.566,126.978", &p).await.is_err());
    {
        let d = data.lock().unwrap();
        assert_eq!(d.puts, 1);
        let k = d.objects.keys().next().unwrap();
        assert!(k.starts_with("/server2-s10/geocode/address/v1/"));
        assert!(!k.contains("37.566") && !k.contains("서울"));
    }
    let key = data.lock().unwrap().objects.keys().next().unwrap().clone();
    let mut expired = projection();
    expired.updated_unix_ms = 1;
    data.lock()
        .unwrap()
        .objects
        .insert(key.clone(), serde_json::to_vec(&expired).unwrap());
    assert!(store.get("서울").await.unwrap().is_none());
    data.lock()
        .unwrap()
        .objects
        .insert(key.clone(), b"bad json".to_vec());
    assert!(store.get("서울").await.unwrap().is_none());
    data.lock().unwrap().objects.insert(key, vec![b'x'; 16385]);
    assert!(store.get("서울").await.is_err());
    data.lock().unwrap().fail = true;
    assert!(store.put("서울", &p).await.is_err());
    data.lock().unwrap().fail = false;
    data.lock().unwrap().corrupt_after_write = true;
    assert!(store.put("서울", &p).await.is_err());
    task.abort();
}
