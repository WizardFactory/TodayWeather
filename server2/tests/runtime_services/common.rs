use server2::{Config, SharedState, gateway::runtime::Builtins, runtime_services::RuntimeServices};
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::Arc,
    time::Duration,
};

pub struct Peer {
    child: Child,
    pub endpoint: String,
}
impl Peer {
    pub fn new() -> Self {
        Self::start(&[])
    }
    /// Case-specific HTTP reuse; the default peer and its admission/socket bounds stay unchanged.
    pub fn persistent() -> Self {
        Self::start(&["--persistent"])
    }
    fn start(args: &[&str]) -> Self {
        let mut child = Command::new("python3")
            .arg("tests/storage/catalog_peer.py")
            .args(args)
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        assert!(line.starts_with("http://127.0.0.1:"));
        Self {
            child,
            endpoint: line.trim().to_owned(),
        }
    }
    pub fn builtins(&self) -> Builtins {
        let dead = "http://127.0.0.1:9/".to_owned();
        Builtins {
            s3: Some(self.endpoint.clone()),
            instance_metadata: Some(dead.clone()),
            data_go_kr: dead.clone(),
            kma: dead.clone(),
            kma_weather: dead.clone(),
            mfds: dead.clone(),
            airkorea_images: dead.clone(),
            vc: dead.clone(),
            google_air: dead.clone(),
            openweather: dead.clone(),
            waqi: dead.clone(),
            kakao: dead.clone(),
            google: dead,
            ..Builtins::production()
        }
    }
    pub fn vars(&self, families: &str) -> impl Fn(&str) -> Option<String> + use<> {
        let families = families.to_owned();
        move |n| match n {
            "SERVER2_NATIVE_FAMILIES" => Some(families.clone()),
            "SERVER2_S3_BUCKET" | "AWS_ACCESS_KEY" => Some("server2-local".into()),
            "AWS_SECRET_KEY" => Some("server2-local-secret".into()),
            "SERVER2_S3_REGION" => Some("ap-northeast-2".into()),
            "DONGNAE_SECRET_KEYS" => Some(r#"["synthetic-data-go-kr-key-0001"]"#.into()),
            "VC_SECRET_KEY" => Some("synthetic-vc-key".into()),
            _ => None,
        }
    }
    pub fn services(&self, families: &str) -> RuntimeServices {
        RuntimeServices::from_vars_at(&self.vars(families), &self.builtins()).unwrap()
    }
    pub async fn fault(&self, mode: &str, key: &str) {
        let mut url: reqwest::Url = format!("{}__catalog", self.endpoint).parse().unwrap();
        url.query_pairs_mut()
            .append_pair("mode", mode)
            .append_pair("key", key);
        assert_eq!(
            reqwest::Client::new()
                .post(url)
                .header("X-Server2-Test-Key", "server2-local")
                .send()
                .await
                .unwrap()
                .status(),
            204
        );
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub struct Http {
    pub base: String,
    task: tokio::task::JoinHandle<()>,
}
impl Http {
    pub async fn new(services: RuntimeServices) -> Self {
        let config = Config::default();
        let app = services.public_router(Arc::new(SharedState::new(&config)));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self { base, task }
    }
}
impl Drop for Http {
    fn drop(&mut self) {
        self.task.abort();
    }
}
pub async fn ready(s: &RuntimeServices) {
    if let Some(push) = &s.push {
        tokio::time::timeout(Duration::from_secs(3), async {
            while !push.ready() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
    }
}

#[tokio::test]
async fn fixture_http_reuse_is_case_specific_and_default_is_unchanged() {
    for (peer, version) in [
        (Peer::new(), reqwest::Version::HTTP_10),
        (Peer::persistent(), reqwest::Version::HTTP_11),
    ] {
        let client = reqwest::Client::new();
        for _ in 0..2 {
            let response = client
                .get(format!("{}__catalog/status", peer.endpoint))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 200);
            assert_eq!(response.version(), version);
            let _: serde_json::Value =
                serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
        }
    }
}
