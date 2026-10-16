//! Firebase Cloud Messaging HTTP v1 sends, as firebase-admin 5.13.1 `messaging().send(message)`
//! made them for the legacy worker (`lib/pushProviders.js`, `controllerPush.sendFcmNotification`):
//! a service-account OAuth token (RS256 JWT
//! assertion, one-hour lifetime) and `POST /v1/projects/{project}/messages:send`.
//!
//! D02: exactly one HTTP request per delivery. firebase-admin retried a send once after a
//! network error (`HttpRequestHandler.sendRequest`), which could deliver twice; server2 does
//! not, and reports the outcome as unknown instead. reqwest retries are disabled; redirects are not
//! followed. Responses are classified with firebase-admin's rules
//! (`FirebaseMessagingRequestHandler`, `FirebaseMessagingError.fromServerError`).
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ring::{rand::SystemRandom, signature};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::Mutex;

/// firebase-admin `FIREBASE_MESSAGING_TIMEOUT` (10 s socket timeout; server2 bounds the whole
/// request).
pub const SEND_TIMEOUT: Duration = Duration::from_secs(10);
/// Bound of the OAuth token request (firebase-admin set none).
pub const TOKEN_TIMEOUT: Duration = Duration::from_secs(10);
const SCOPES: &str = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/userinfo.email";
/// The token endpoint and assertion audience Google documents for service accounts
/// (https://developers.google.com/identity/protocols/oauth2/service-account: "always
/// `https://oauth2.googleapis.com/token`"). firebase-admin 5.13.1 used the older
/// `https://accounts.google.com/o/oauth2/token` (`lib/auth/credential.js` GOOGLE_TOKEN_AUDIENCE).
const AUDIENCE: &str = "https://oauth2.googleapis.com/token";

/// Built-in Google endpoints (tests reach loopback doubles through [`Endpoints::loopback`]).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoints {
    pub token: String,
    pub fcm: String,
}
impl Endpoints {
    pub fn production() -> Self {
        Self {
            token: AUDIENCE.into(),
            fcm: "https://fcm.googleapis.com/".into(),
        }
    }
    /// Test-only roots (a loopback double).
    pub fn loopback(root: &str) -> Self {
        Self {
            token: format!("{root}o/oauth2/token"),
            fcm: root.into(),
        }
    }
}

/// The two Firebase apps of `lib/pushProviders.js`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Product {
    TodayWeather,
    TodayAir,
}
impl Product {
    /// `package === 'todayAir'` selects TodayAir, anything else TodayWeather.
    pub fn of(package: &crate::world::js::Val) -> Self {
        if *package == crate::world::js::Val::Str("todayAir".into()) {
            Product::TodayAir
        } else {
            Product::TodayWeather
        }
    }
    /// server2 setting naming the service-account JSON file of the product.
    pub fn setting(self) -> &'static str {
        match self {
            Product::TodayWeather => "SERVER2_FIREBASE_TODAYWEATHER",
            Product::TodayAir => "SERVER2_FIREBASE_TODAYAIR",
        }
    }
}

/// A Firebase service account (`project_id`, `client_email`, PKCS#8 `private_key`).
pub struct Account {
    pub project_id: String,
    pub client_email: String,
    key: signature::RsaKeyPair,
}
impl Account {
    pub fn parse(json: &[u8]) -> Result<Self, &'static str> {
        let v: serde_json::Value = serde_json::from_slice(json).map_err(|_| "account json")?;
        let text = |k: &str| v.get(k).and_then(|x| x.as_str()).filter(|s| !s.is_empty());
        let pem = text("private_key").ok_or("account private_key")?;
        let body: String = pem
            .lines()
            .filter(|l| !l.starts_with("-----"))
            .collect::<Vec<_>>()
            .join("");
        let der = base64::engine::general_purpose::STANDARD
            .decode(body.trim())
            .map_err(|_| "account private_key")?;
        let key = signature::RsaKeyPair::from_pkcs8(&der).map_err(|_| "account private_key")?;
        Ok(Self {
            project_id: text("project_id").ok_or("account project_id")?.to_owned(),
            client_email: text("client_email")
                .ok_or("account client_email")?
                .to_owned(),
            key,
        })
    }
    /// jsonwebtoken 8 `sign(claims, key, {audience, expiresIn: 3600, issuer, algorithm})`.
    pub fn assertion(&self, now_ms: i64) -> Result<String, &'static str> {
        let iat = now_ms.div_euclid(1000);
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"RS256","typ":"JWT"}"#);
        let claims = format!(
            "{{\"scope\":{},\"iat\":{iat},\"exp\":{},\"aud\":{},\"iss\":{}}}",
            serde_json::to_string(SCOPES).expect("string"),
            iat + 3600,
            serde_json::to_string(AUDIENCE).expect("string"),
            serde_json::to_string(&self.client_email).expect("string"),
        );
        let input = format!("{header}.{}", URL_SAFE_NO_PAD.encode(claims.as_bytes()));
        let mut sig = vec![0u8; self.key.public().modulus_len()];
        self.key
            .sign(
                &signature::RSA_PKCS1_SHA256,
                &SystemRandom::new(),
                input.as_bytes(),
                &mut sig,
            )
            .map_err(|_| "assertion signature")?;
        Ok(format!("{input}.{}", URL_SAFE_NO_PAD.encode(sig)))
    }
}

/// The result of one send attempt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SendOutcome {
    /// FCM accepted the message.
    Accepted,
    /// `messaging/registration-token-not-registered`: the token is disabled (legacy
    /// `disableByFcm`), the delivery counts as handled.
    Unregistered { status: u16 },
    /// FCM refused the message (firebase-admin client code, e.g. `messaging/invalid-argument`).
    Rejected { status: u16, code: String },
    /// The request may have reached FCM but no answer was read (transport error after sending,
    /// timeout). Never retried.
    Unknown { reason: &'static str },
    /// No FCM request was made (credentials unusable or the OAuth token request failed).
    NotSent { reason: &'static str },
}

struct Token {
    access: String,
    expires_ms: i64,
}

pub struct Fcm {
    client: reqwest::Client,
    send_timeout: Duration,
    endpoints: Endpoints,
    accounts: HashMap<Product, Option<std::path::PathBuf>>,
    loaded: Mutex<HashMap<Product, Arc<Account>>>,
    tokens: Mutex<HashMap<Product, Token>>,
}

impl Fcm {
    /// Account file paths from the server2 settings; a missing setting fails that product's
    /// sends (legacy failed per send when its account file was missing).
    pub fn from_vars(
        var: &dyn Fn(&str) -> Option<String>,
        endpoints: Endpoints,
    ) -> Result<Self, String> {
        let mut accounts = HashMap::new();
        for p in [Product::TodayWeather, Product::TodayAir] {
            accounts.insert(
                p,
                var(p.setting()).filter(|v| !v.is_empty()).map(Into::into),
            );
        }
        Ok(Self {
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                // reqwest otherwise re-sends requests refused by an HTTP/2 protocol NACK.
                .retry(reqwest::retry::never())
                .build()
                .map_err(|e| e.to_string())?,
            send_timeout: SEND_TIMEOUT,
            endpoints,
            accounts,
            loaded: Mutex::new(HashMap::new()),
            tokens: Mutex::new(HashMap::new()),
        })
    }

    /// Test-only: a shorter send bound to exercise the timeout path quickly.
    pub fn with_send_timeout(mut self, timeout: Duration) -> Self {
        self.send_timeout = timeout;
        self
    }

    async fn account(&self, product: Product) -> Option<Arc<Account>> {
        let mut loaded = self.loaded.lock().await;
        if let Some(a) = loaded.get(&product) {
            return Some(a.clone());
        }
        let path = self.accounts.get(&product)?.as_ref()?;
        let account = Arc::new(Account::parse(&std::fs::read(path).ok()?).ok()?);
        loaded.insert(product, account.clone());
        Some(account)
    }

    /// A cached access token, refreshed when it expires within a minute (one request at a time
    /// per product; a failure is not cached).
    async fn token(&self, product: Product, account: &Account, now_ms: i64) -> Option<String> {
        let mut tokens = self.tokens.lock().await;
        if let Some(t) = tokens.get(&product)
            && t.expires_ms - 60_000 >= now_ms
        {
            return Some(t.access.clone());
        }
        let assertion = account.assertion(now_ms).ok()?;
        let body = format!(
            "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion={assertion}"
        );
        let response = self
            .client
            .post(&self.endpoints.token)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(body)
            .timeout(TOKEN_TIMEOUT)
            .send()
            .await
            .ok()?;
        let json: serde_json::Value = serde_json::from_slice(&response.bytes().await.ok()?).ok()?;
        if json.get("error").is_some() {
            return None;
        }
        let access = json.get("access_token")?.as_str()?.to_owned();
        let expires_in = json.get("expires_in")?.as_f64()?;
        tokens.insert(
            product,
            Token {
                access: access.clone(),
                expires_ms: now_ms + (expires_in * 1000.) as i64,
            },
        );
        Some(access)
    }

    /// One `messages:send` request with the given JSON body (`{"message": ...}`).
    pub async fn send(&self, product: Product, body: Vec<u8>, now_ms: i64) -> SendOutcome {
        let Some(account) = self.account(product).await else {
            return SendOutcome::NotSent {
                reason: "credentials",
            };
        };
        let Some(token) = self.token(product, &account, now_ms).await else {
            return SendOutcome::NotSent { reason: "oauth" };
        };
        let url = format!(
            "{}v1/projects/{}/messages:send",
            self.endpoints.fcm, account.project_id
        );
        let sent = self
            .client
            .post(url)
            .header("content-type", "application/json")
            .header("access_token_auth", "true")
            .header("authorization", format!("Bearer {token}"))
            .body(body)
            .timeout(self.send_timeout)
            .send()
            .await;
        let response = match sent {
            Ok(r) => r,
            Err(e) if e.is_timeout() => return SendOutcome::Unknown { reason: "timeout" },
            Err(e) if e.is_connect() => return SendOutcome::NotSent { reason: "connect" },
            Err(_) => {
                return SendOutcome::Unknown {
                    reason: "transport",
                };
            }
        };
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/json")
            .to_owned();
        let Ok(bytes) = response.bytes().await else {
            return SendOutcome::Unknown {
                reason: "transport",
            };
        };
        classify(status, &content_type, &bytes)
    }
}

/// firebase-admin 5.13.1 response handling.
pub fn classify(status: u16, content_type: &str, body: &[u8]) -> SendOutcome {
    let text = content_type.contains("text/html") || content_type.contains("text/plain");
    if text {
        // A text answer is an error even with 2xx; the code follows the status.
        let code = match status {
            400 => "messaging/invalid-argument",
            401 | 403 => "messaging/authentication-error",
            500 => "messaging/internal-error",
            503 => "messaging/server-unavailable",
            _ => "messaging/unknown-error",
        };
        return SendOutcome::Rejected {
            status,
            code: code.into(),
        };
    }
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(body) else {
        return SendOutcome::Rejected {
            status,
            code: "app/unable-to-parse-response".into(),
        };
    };
    let error_code = error_code(&json);
    if (200..300).contains(&status) && error_code.is_none() {
        return SendOutcome::Accepted;
    }
    let code = client_code(error_code.as_deref().unwrap_or(""));
    if code == "messaging/registration-token-not-registered" {
        SendOutcome::Unregistered { status }
    } else {
        SendOutcome::Rejected {
            status,
            code: code.into(),
        }
    }
}

/// `FirebaseMessagingRequestHandler.getErrorCode`.
fn error_code(json: &serde_json::Value) -> Option<String> {
    let error = json.as_object()?.get("error")?;
    if let Some(s) = error.as_str() {
        return Some(s.to_owned());
    }
    if let Some(details) = error.get("details").and_then(|d| d.as_array()) {
        for d in details {
            if d.get("@type").and_then(|t| t.as_str())
                == Some("type.googleapis.com/google.firebase.fcm.v1.FcmErrorCode")
            {
                return Some(
                    d.get("errorCode")
                        .map(|c| c.as_str().unwrap_or("").to_owned())
                        .unwrap_or_default(),
                );
            }
        }
    }
    if let Some(status) = error.get("status") {
        return Some(status.as_str().unwrap_or("").to_owned());
    }
    Some(
        error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_owned(),
    )
}

/// `MESSAGING_SERVER_TO_CLIENT_CODE` of firebase-admin 5.13.1.
fn client_code(server: &str) -> &'static str {
    match server {
        "InvalidParameters" | "INVALID_ARGUMENT" => "messaging/invalid-argument",
        "MismatchSenderId" | "PERMISSION_DENIED" | "SENDER_ID_MISMATCH" => {
            "messaging/mismatched-credential"
        }
        "Unavailable" | "UNAVAILABLE" => "messaging/server-unavailable",
        "InternalServerError" | "INTERNAL" => "messaging/internal-error",
        "InvalidRegistration" => "messaging/invalid-registration-token",
        "NotRegistered" | "NOT_FOUND" => "messaging/registration-token-not-registered",
        "InvalidPackageName" => "messaging/invalid-package-name",
        "MessageTooBig" => "messaging/payload-size-limit-exceeded",
        "InvalidDataKey" => "messaging/invalid-data-payload-key",
        "InvalidTtl" => "messaging/invalid-options",
        "DeviceMessageRateExceeded" => "messaging/device-message-rate-exceeded",
        "TopicsMessageRateExceeded" => "messaging/topics-message-rate-exceeded",
        "InvalidApnsCredential" | "UNAUTHENTICATED" | "APNS_AUTH_ERROR" => {
            "messaging/invalid-apns-credentials"
        }
        "RESOURCE_EXHAUSTED" | "QUOTA_EXCEEDED" => "messaging/message-rate-exceeded",
        _ => "messaging/unknown-error",
    }
}
