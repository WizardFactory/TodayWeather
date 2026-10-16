use serde_json::{Value, json};
use server2::notice::{
    Notice, Provenance, Text,
    translate::{Settings, Translator, Transport},
};
use std::sync::{Arc, Mutex};
#[derive(Clone, Default)]
struct Stub {
    calls: Arc<Mutex<Vec<Value>>>,
    failure: bool,
}
impl Transport for Stub {
    async fn post(&self, body: Vec<u8>, _key: &str) -> Result<Vec<u8>, server2::notice::Error> {
        let v: Value = serde_json::from_slice(&body).unwrap();
        self.calls.lock().unwrap().push(v);
        if self.failure {
            return Ok(serde_json::to_vec(&json!({"status":"incomplete","output":[]})).unwrap());
        }
        Ok(serde_json::to_vec(&json!({"status":"completed","model":"configured-response-model","output":[{"type":"message","content":[{"type":"output_text","text":"{\"title\":\"Translated\",\"body\":\"Everyday wording\"}"}]}]})).unwrap())
    }
}
fn notice() -> Notice {
    Notice::from_input(1,&json!({"texts":{"ko":{"title":"안내","body":"서비스 안내입니다."},"en":{"title":"Provided","body":"Keep this"}}}),0).unwrap()
}
#[tokio::test]
async fn publish_translation_fills_only_missing_languages_with_real_request_shape_and_provenance() {
    let stub = Stub::default();
    let settings = Settings::from_lookup(|k| match k {
        "OPENAI_SECRET_KEY" => Some("synthetic".into()),
        "TRANSLATION_LLM_MODEL" => Some("explicit-model".into()),
        "TRANSLATION_LLM_REASONING_EFFORT" => Some(String::new()),
        _ => None,
    })
    .unwrap();
    let out = Translator::new(settings, stub.clone())
        .fill(&notice())
        .await;
    assert_eq!(out.texts.len(), 5);
    assert!(out.failed.is_empty());
    assert!(!out.texts.contains_key("en"));
    assert_eq!(
        out.texts["fr"],
        Text {
            title: "Translated".into(),
            body: "Everyday wording".into(),
            translated: Some(Provenance {
                from: "ko".into(),
                model: "configured-response-model".into()
            })
        }
    );
    let calls = stub.calls.lock().unwrap();
    assert_eq!(calls.len(), 5);
    for v in calls.iter() {
        assert_eq!(v["model"], "explicit-model");
        assert_eq!(v["store"], false);
        assert_eq!(v["text"]["format"]["type"], "json_schema");
        assert!(v.get("reasoning").is_none());
        assert!(v["instructions"].as_str().unwrap().contains("everyday"));
    }
}
#[tokio::test]
async fn no_key_calls_nothing_and_partial_failure_never_invents_texts() {
    let stub = Stub::default();
    let t = Translator::new(Settings::from_lookup(|_| None).unwrap(), stub.clone());
    let out = t.fill(&notice()).await;
    assert!(out.skipped);
    assert_eq!(stub.calls.lock().unwrap().len(), 0);
    let stub = Stub {
        failure: true,
        ..Default::default()
    };
    let settings =
        Settings::from_lookup(|k| (k == "OPENAI_SECRET_KEY").then(|| "synthetic".into())).unwrap();
    let out = Translator::new(settings, stub.clone())
        .fill(&notice())
        .await;
    assert_eq!(out.failed.len(), 5);
    assert!(out.texts.is_empty());
    assert_eq!(stub.calls.lock().unwrap()[0]["reasoning"]["effort"], "none");
}

#[derive(Clone)]
struct Response(Vec<u8>);
impl Transport for Response {
    async fn post(&self, _: Vec<u8>, _: &str) -> Result<Vec<u8>, server2::notice::Error> {
        Ok(self.0.clone())
    }
}
#[tokio::test]
async fn refused_malformed_markup_or_overlimit_responses_never_become_stored_texts() {
    for v in [
        json!({"status":"completed","output":[{"type":"message","content":[{"type":"refusal","refusal":"No"}]}]}),
        json!({"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"{"}]}]}),
        json!({"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":json!({"title":"<script>x</script>","body":"body"}).to_string()}]}]}),
        json!({"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":json!({"title":"x".repeat(101),"body":"body"}).to_string()}]}]}),
    ] {
        let settings =
            Settings::from_lookup(|k| (k == "OPENAI_SECRET_KEY").then(|| "synthetic".into()))
                .unwrap();
        let out = Translator::new(settings, Response(serde_json::to_vec(&v).unwrap()))
            .fill(&notice())
            .await;
        assert!(out.texts.is_empty());
        assert_eq!(out.failed.len(), 5);
    }
}

#[derive(Clone, Default)]
pub struct PerLanguage {
    pub targets: Arc<Mutex<Vec<String>>>,
    pub fail_fr: bool,
}
impl Transport for PerLanguage {
    async fn post(&self, body: Vec<u8>, _: &str) -> Result<Vec<u8>, server2::notice::Error> {
        let request: Value = serde_json::from_slice(&body).unwrap();
        let input: Value = serde_json::from_str(request["input"].as_str().unwrap()).unwrap();
        let target = input["targetLanguage"].as_str().unwrap();
        self.targets.lock().unwrap().push(target.into());
        if self.fail_fr && target == "fr" {
            return Err(server2::notice::Error::Translation("synthetic"));
        }
        Ok(serde_json::to_vec(&json!({"status":"completed","model":"synthetic","output":[{"type":"message","content":[{"type":"output_text","text":json!({"title":format!("Title {target}"),"body":format!("Body {target}")}).to_string()}]}]})).unwrap())
    }
}
