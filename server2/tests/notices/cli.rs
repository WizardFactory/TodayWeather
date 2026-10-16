use super::common::Memory;
use serde_json::{Value, json};
use server2::notice::{
    Error, cli,
    store::NoticeStore,
    translate::{Settings, Translator, Transport},
};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
#[derive(Clone, Default)]
struct NoCall(Arc<AtomicUsize>);
impl Transport for NoCall {
    async fn post(&self, _: Vec<u8>, _: &str) -> Result<Vec<u8>, Error> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Err(Error::Translation("synthetic failure"))
    }
}
#[tokio::test]
async fn cli_add_update_translate_withdraw_and_invalid_input_keep_durable_contract() {
    let m = Memory::default();
    let s = NoticeStore::new(m.clone());
    let calls = NoCall::default();
    let t = Translator::new(Settings::from_lookup(|_| None).unwrap(), calls.clone());
    let body =
        serde_json::to_vec(&json!({"texts":{"ko":{"title":"공지","body":"공지 본문"}}})).unwrap();
    let out = cli::execute(&s, &t, &["add".into()], &body, 0, &"a".repeat(64))
        .await
        .unwrap();
    assert_eq!(out.json["id"], 1);
    assert!(!out.warnings.is_empty());
    assert_eq!(calls.0.load(Ordering::SeqCst), 0);
    let before = m.0.lock().unwrap().object.clone();
    assert!(
        cli::execute(
            &s,
            &t,
            &["update".into(), "1".into()],
            br#"{"linkUrl":"http://bad.example"}"#,
            1,
            &"b".repeat(64)
        )
        .await
        .is_err()
    );
    assert_eq!(m.0.lock().unwrap().object, before);
    cli::execute(
        &s,
        &t,
        &["update".into(), "1".into()],
        br#"{"linkUrl":"https://example.com/info"}"#,
        1,
        &"c".repeat(64),
    )
    .await
    .unwrap();
    let out = cli::execute(
        &s,
        &t,
        &["show".into(), "1".into()],
        b"",
        1,
        &"d".repeat(64),
    )
    .await
    .unwrap();
    assert_eq!(out.json["linkUrl"], "https://example.com/info");
    assert_eq!(out.json["texts"]["ko"]["title"], "공지");
    let out = cli::execute(
        &s,
        &t,
        &["latest".into(), "zh".into()],
        b"",
        1,
        &"e".repeat(64),
    )
    .await
    .unwrap();
    assert_eq!(out.json["notice"]["lang"], "ko");
    cli::execute(
        &s,
        &t,
        &["withdraw".into(), "1".into()],
        b"",
        2,
        &"f".repeat(64),
    )
    .await
    .unwrap();
    let out = cli::execute(&s, &t, &["latest".into()], b"", 2, &"0".repeat(64))
        .await
        .unwrap();
    assert_eq!(out.json["notice"], Value::Null);
}

#[tokio::test]
async fn failed_language_publishes_original_and_translate_fills_only_missing_language() {
    use super::translation::PerLanguage;
    let s = NoticeStore::new(Memory::default());
    let first = PerLanguage {
        fail_fr: true,
        ..Default::default()
    };
    let settings = || {
        Settings::from_lookup(|k| (k == "OPENAI_SECRET_KEY").then(|| "synthetic".into())).unwrap()
    };
    let t = Translator::new(settings(), first.clone());
    let body = serde_json::to_vec(&json!({"texts":{"ko":{"title":"공지","body":"본문"}}})).unwrap();
    let out = cli::execute(&s, &t, &["add".into()], &body, 0, &"a".repeat(64))
        .await
        .unwrap();
    assert_eq!(out.warnings, vec!["notice translation failed: fr"]);
    let original = s.canonical().await.unwrap().records[0].clone();
    assert_eq!(original.texts.len(), 6);
    assert!(!original.texts.contains_key("fr"));
    let next = PerLanguage::default();
    let t = Translator::new(settings(), next.clone());
    cli::execute(
        &s,
        &t,
        &["translate".into(), "1".into()],
        b"",
        1,
        &"b".repeat(64),
    )
    .await
    .unwrap();
    let updated = s.canonical().await.unwrap().records[0].clone();
    assert_eq!(*next.targets.lock().unwrap(), vec!["fr"]);
    for (lang, text) in original.texts {
        assert_eq!(updated.texts[&lang], text);
    }
}

struct HeldTranslation {
    entered: Arc<tokio::sync::Notify>,
    release: Arc<tokio::sync::Notify>,
    first: std::sync::atomic::AtomicBool,
}
impl Transport for HeldTranslation {
    async fn post(&self, _: Vec<u8>, _: &str) -> Result<Vec<u8>, Error> {
        if !self.first.swap(true, Ordering::SeqCst) {
            self.entered.notify_one();
            self.release.notified().await;
        }
        Ok(serde_json::to_vec(&json!({"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"{\"title\":\"Old generated\",\"body\":\"Old body\"}"}]}]})).unwrap())
    }
}
#[tokio::test]
async fn source_changed_while_cli_translation_waits_refuses_stale_application() {
    let m = Memory::default();
    let s = Arc::new(NoticeStore::new(m.clone()));
    s.apply(
        &"a".repeat(64),
        server2::notice::store::Mutation::Add(
            json!({"texts":{"en":{"title":"Old","body":"Old body"}}}),
        ),
        0,
    )
    .await
    .unwrap();
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let t = Translator::new(
        Settings::from_lookup(|k| (k == "OPENAI_SECRET_KEY").then(|| "synthetic".into())).unwrap(),
        HeldTranslation {
            entered: entered.clone(),
            release: release.clone(),
            first: std::sync::atomic::AtomicBool::new(false),
        },
    );
    let worker = s.clone();
    let job = tokio::spawn(async move {
        cli::execute(
            &worker,
            &t,
            &["translate".into(), "1".into()],
            b"",
            1,
            &"b".repeat(64),
        )
        .await
    });
    entered.notified().await;
    NoticeStore::new(m)
        .apply(
            &"c".repeat(64),
            server2::notice::store::Mutation::Update {
                id: 1,
                input: json!({"texts":{"en":{"title":"New","body":"Current source"}}}),
                expected_source: None,
            },
            1,
        )
        .await
        .unwrap();
    release.notify_one();
    assert!(matches!(job.await.unwrap(), Err(Error::Conflict)));
    let state = s.canonical().await.unwrap();
    assert_eq!(state.records[0].texts.len(), 1);
    assert_eq!(state.records[0].texts["en"].title, "New");
}
