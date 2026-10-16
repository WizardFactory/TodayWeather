//! Actual localhost HTTP S3/Responses/API scenario. Synthetic data; never loads .env.
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::Request,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use server2::{
    notice::{
        api, cli,
        store::{Mutation, NoticeStore},
        translate::{Settings, Translator, Transport},
    },
    storage::{HttpS3Transport, S3Settings},
};
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};
use tokio::net::TcpListener;

#[derive(Default)]
struct S3 {
    body: Option<Vec<u8>>,
    revision: u64,
    delayed: bool,
    pending: Option<Vec<u8>>,
    reads: usize,
}
async fn peer(state: Arc<Mutex<S3>>, request: Request) -> Response {
    let method = request.method().clone();
    let headers = request.headers().clone();
    if method == "GET" {
        let mut s = state.lock().unwrap();
        s.reads += 1;
        if s.delayed && s.pending.is_some() && s.reads >= 3 {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
        return match &s.body {
            Some(body) => {
                let mut r = Body::from(body.clone()).into_response();
                r.headers_mut()
                    .insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
                r.headers_mut().insert(
                    header::ETAG,
                    format!("\"v{}\"", s.revision).parse().unwrap(),
                );
                r
            }
            None => StatusCode::NOT_FOUND.into_response(),
        };
    }
    if method == "PUT" {
        let bytes = to_bytes(request.into_body(), 8 * 1024 * 1024)
            .await
            .unwrap();
        let mut s = state.lock().unwrap();
        let condition = if s.body.is_none() {
            headers.get(header::IF_NONE_MATCH).is_some_and(|h| h == "*")
        } else {
            headers
                .get(header::IF_MATCH)
                .is_some_and(|h| h == format!("\"v{}\"", s.revision).as_str())
        };
        if !condition {
            return StatusCode::PRECONDITION_FAILED.into_response();
        }
        if s.delayed {
            s.pending.get_or_insert(bytes.to_vec());
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
        s.body = Some(bytes.to_vec());
        s.revision += 1;
        return StatusCode::OK.into_response();
    }
    StatusCode::METHOD_NOT_ALLOWED.into_response()
}
fn transport(endpoint: &str) -> HttpS3Transport {
    let vars = BTreeMap::from([
        ("SERVER2_S3_BUCKET", "synthetic-notices".to_owned()),
        ("AWS_ACCESS_KEY", "synthetic".to_owned()),
        ("AWS_SECRET_KEY", "synthetic-only".to_owned()),
    ]);
    S3Settings::from_vars_at(&|k| vars.get(k).cloned(), Some(endpoint))
        .unwrap()
        .transport()
        .unwrap()
}
struct LocalResponses {
    url: String,
    client: reqwest::Client,
}
impl Transport for LocalResponses {
    async fn post(&self, body: Vec<u8>, _: &str) -> Result<Vec<u8>, server2::notice::Error> {
        Ok(self
            .client
            .post(&self.url)
            .header("content-type", "application/json")
            .body(body)
            .send()
            .await
            .map_err(|_| server2::notice::Error::Translation("local HTTP"))?
            .bytes()
            .await
            .map_err(|_| server2::notice::Error::Translation("local body"))?
            .to_vec())
    }
}
#[tokio::main]
async fn main() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let s3 = Arc::new(Mutex::new(S3::default()));
    let ss = s3.clone();
    let s3_job = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().fallback(move |r| peer(ss.clone(), r)),
        )
        .await
        .unwrap()
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let response_url = format!("http://{}/v1/responses", listener.local_addr().unwrap());
    let translations = Arc::new(AtomicUsize::new(0));
    let count = translations.clone();
    let responses_job = tokio::spawn(async move {
        axum::serve(listener,Router::new().fallback(move|r:Request|{let count=count.clone();async move{
  let b=to_bytes(r.into_body(),65536).await.unwrap();let request:Value=serde_json::from_slice(&b).unwrap();assert_eq!(request["store"],false);assert_eq!(request["text"]["format"]["type"],"json_schema");count.fetch_add(1,Ordering::SeqCst);
  axum::Json(json!({"status":"completed","model":"synthetic-response-model","output":[{"type":"message","content":[{"type":"output_text","text":"{\"title\":\"Translated notice\",\"body\":\"Service information\"}"}]}]}))
 }})).await.unwrap()
    });
    let settings = Settings::from_lookup(|k| {
        (k == "OPENAI_SECRET_KEY").then(|| "synthetic-not-used-as-auth".into())
    })
    .unwrap();
    let translator = Translator::new(
        settings,
        LocalResponses {
            url: response_url,
            client: reqwest::Client::new(),
        },
    );
    let store = Arc::new(NoticeStore::new(transport(&endpoint)));
    let input =
        serde_json::to_vec(&json!({"texts":{"ko":{"title":"공지","body":"서비스 안내입니다."}}}))
            .unwrap();
    let added = cli::execute(
        &store,
        &translator,
        &["add".into()],
        &input,
        0,
        &"a".repeat(64),
    )
    .await
    .unwrap();
    assert_eq!(added.json["id"], 1);
    assert!(added.warnings.is_empty());
    assert_eq!(translations.load(Ordering::SeqCst), 6);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let api_url = format!(
        "http://{}/v000903/notice/latest",
        listener.local_addr().unwrap()
    );
    let app = api::router_with_clock(
        Arc::new(NoticeStore::new(transport(&endpoint))),
        Arc::new(|| 1000),
    );
    let api_job = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{api_url}?lang=fr-FR"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.headers()["cache-control"], "public, max-age=300");
    let bytes = response.bytes().await.unwrap();
    let v: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(v["notice"]["id"], 1);
    assert_eq!(v["notice"]["lang"], "fr");
    assert_eq!(translations.load(Ordering::SeqCst), 6);
    cli::execute(
        &store,
        &translator,
        &["withdraw".into(), "1".into()],
        b"",
        2000,
        &"b".repeat(64),
    )
    .await
    .unwrap();
    let bytes = client
        .get(&api_url)
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    let v: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(v["notice"], Value::Null);
    assert_eq!(translations.load(Ordering::SeqCst), 6);
    // S18C-R1 actual HTTP: failed PUT response before delayed durable commit,
    // unchanged readback, then failing GET must retain the original operation ID.
    let fault_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let fault_endpoint = format!("http://{}", fault_listener.local_addr().unwrap());
    let fault_s3 = Arc::new(Mutex::new(S3 {
        delayed: true,
        ..S3::default()
    }));
    let fault_state = fault_s3.clone();
    let fault_job = tokio::spawn(async move {
        axum::serve(
            fault_listener,
            Router::new().fallback(move |r| peer(fault_state.clone(), r)),
        )
        .await
        .unwrap()
    });
    let operation = "c".repeat(64);
    let mutation =
        Mutation::Add(json!({"texts":{"en":{"title":"Delayed","body":"One publication"}}}));
    assert_eq!(
        NoticeStore::new(transport(&fault_endpoint))
            .apply(&operation, mutation.clone(), 0)
            .await
            .unwrap_err(),
        server2::notice::Error::Uncertain
    );
    {
        let mut state = fault_s3.lock().unwrap();
        assert!(state.body.is_none());
        state.body = state.pending.take();
        state.revision = 1;
        state.delayed = false;
    }
    let recovered = NoticeStore::new(transport(&fault_endpoint));
    assert_eq!(recovered.apply(&operation, mutation, 0).await.unwrap(), 1);
    assert_eq!(recovered.canonical().await.unwrap().records.len(), 1);
    assert_eq!(fault_s3.lock().unwrap().revision, 1);
    fault_job.abort();
    println!(
        "{}",
        json!({"scenario":"notice-cli-s3-api","outcome":"PASS","s3_http":true,"cli_add_id":1,"responses_local_calls":6,"api_language":"fr","restart_reads_s3":true,"withdrawn_notice":null,"request_path_translations":0,"external_calls":0,"delayed_commit_recovery":true,"delayed_durable_adds":1})
    );
    s3_job.abort();
    responses_job.abort();
    api_job.abort();
}
