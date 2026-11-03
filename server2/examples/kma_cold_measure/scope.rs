//! Task-only namespace and conservative operation/body budgets over the native signer.
use rusty_s3::S3Action;
use serde_json::{Value, json};
use server2::{
    budget::{BudgetError, BudgetObject, BudgetTransport},
    history::IndexListing,
    providers::{
        HttpProviderTransport, HttpPublicTransport, ProviderResponse, ProviderTransport,
        ProviderTransportError, PublicRequest, PublicTransport, Request,
    },
    storage::{
        CatalogTransport, ControlObject, Error, HttpS3Transport, ListPage, Object, ObjectTransport,
        PreparedRecord, WriteCondition,
    },
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub const RESPONSE: usize = 8 * 1024 * 1024;
const HEADERS: usize = 8192;
const BYTES: usize = 250 * 1024 * 1024;

#[derive(Default)]
struct State {
    counts: BTreeMap<&'static str, usize>,
    used: usize,
    reserved: usize,
    events: Vec<Value>,
    denied: usize,
}
pub struct Ledger {
    state: Mutex<State>,
    end: Instant,
}
impl Ledger {
    pub fn resume(value: &Value, remaining: Duration) -> Result<Arc<Self>, Error> {
        if value["inflight_reserved_bytes"].as_u64() != Some(0) {
            return Err(Error::Invalid("unsettled prior run"));
        }
        let ledger = Arc::new(Self {
            state: Mutex::new(State::default()),
            end: Instant::now() + remaining,
        });
        {
            let mut state = ledger.state.lock().unwrap();
            state.used = value["conservative_body_and_header_bytes"]
                .as_u64()
                .ok_or(Error::Invalid("prior byte charge"))? as usize;
            if state.used > BYTES {
                return Err(Error::Invalid("prior budget exhausted"));
            }
            for kind in [
                "provider",
                "put_raw",
                "put_control",
                "put_budget",
                "get_raw",
                "head_raw",
                "get_control",
                "get_group",
                "get_budget",
                "list",
                "list_index",
            ] {
                let count = value["admitted"][kind].as_u64().unwrap_or(0) as usize;
                if count > 50000 {
                    return Err(Error::Invalid("prior operation count"));
                }
                if count > 0 {
                    state.counts.insert(kind, count);
                }
            }
        }
        Ok(ledger)
    }
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State::default()),
            end: Instant::now() + Duration::from_secs(1800),
        })
    }
    fn reserve(self: &Arc<Self>, kind: &'static str, maximum: usize) -> Result<Permit, Error> {
        let mut s = self.state.lock().unwrap();
        let used = *s.counts.get(kind).unwrap_or(&0);
        // Native provider transports allow at most three redirects. Sixty-four
        // transport admissions therefore bound on-wire attempts by256, including
        // redirect hops; acquisition retries obtain a new admission.
        let cap = if kind == "provider" {
            64
        } else if kind.starts_with("put") {
            5000
        } else {
            50000
        };
        let reads: usize = s
            .counts
            .iter()
            .filter(|(k, _)| **k != "provider" && !k.starts_with("put"))
            .map(|(_, v)| v)
            .sum();
        let writes: usize = s
            .counts
            .iter()
            .filter(|(k, _)| k.starts_with("put"))
            .map(|(_, v)| v)
            .sum();
        if Instant::now() >= self.end
            || used >= cap
            || reads >= 49997
            || writes >= 5000
            || maximum > BYTES.saturating_sub(s.used + s.reserved)
        {
            s.denied += 1;
            return Err(Error::Invalid("measurement budget exhausted"));
        }
        *s.counts.entry(kind).or_default() += 1;
        s.reserved += maximum;
        Ok(Permit {
            ledger: self.clone(),
            kind,
            maximum,
            start: Instant::now(),
            done: false,
        })
    }
    pub fn snapshot(&self) -> Value {
        let s = self.state.lock().unwrap();
        json!({"admitted":s.counts,"conservative_body_and_header_bytes":s.used,
            "inflight_reserved_bytes":s.reserved,"denied":s.denied,"events":s.events,
            "limits":{"provider_admissions":64,"provider_wire_attempt_upper_bound":256,"native_s3_reads":49997,"external_preflight_lists":3,"s3_writes":5000,"bytes":BYTES,"wall_seconds":1800}})
    }
}
struct Permit {
    ledger: Arc<Ledger>,
    kind: &'static str,
    maximum: usize,
    start: Instant,
    done: bool,
}
impl Permit {
    fn finish(mut self, bytes: usize, outcome: &str) {
        self.record(bytes.min(self.maximum), outcome);
        self.done = true;
    }
    fn record(&self, bytes: usize, outcome: &str) {
        let mut s = self.ledger.state.lock().unwrap();
        s.reserved -= self.maximum;
        s.used += bytes;
        s.events.push(
            json!({"kind":self.kind,"elapsed_ms":self.start.elapsed().as_secs_f64()*1000.,
            "charged_bytes":bytes,"outcome":outcome}),
        );
    }
}
impl Drop for Permit {
    fn drop(&mut self) {
        if !self.done {
            self.record(self.maximum, "cancelled_or_ambiguous");
        }
    }
}

pub fn valid_prefix(p: &str) -> bool {
    p.starts_with("verification/kma-20261024-")
        && p.ends_with('/')
        && p.len() <= 100
        && p.trim_end_matches('/')
            .split('/')
            .all(|x| !x.is_empty() && x != "." && x != "..")
        && p.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-'))
}
fn map(prefix: &str, key: &str) -> Result<String, Error> {
    if key.is_empty()
        || key.len() > 800
        || key
            .trim_end_matches('/')
            .split('/')
            .any(|x| x.is_empty() || x == "." || x == "..")
        || !key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_' | b'.'))
    {
        return Err(Error::Invalid("measurement key"));
    }
    let mut parts = key.splitn(3, '/');
    let root = format!(
        "{}/{}",
        parts.next().unwrap(),
        parts.next().ok_or(Error::Invalid("measurement root"))?
    );
    if !matches!(root.as_str(), "raw/v2" | "index/v2" | "budgets/v2") {
        return Err(Error::Invalid("measurement root"));
    }
    Ok(format!("{root}/{prefix}{}", parts.next().unwrap_or("")))
}
fn read_charge<T>(r: &Result<T, Error>, maximum: usize, size: impl Fn(&T) -> usize) -> usize {
    match r {
        Ok(v) => size(v) + HEADERS,
        // The native adapter returns before consuming an application body here.
        Err(Error::NotFound | Error::Status(_)) => HEADERS,
        Err(_) => maximum + HEADERS,
    }
}
fn index_page(bytes: &[u8], namespace: &str) -> Result<ListPage, Error> {
    let text = std::str::from_utf8(bytes).map_err(|_| Error::Corrupt("index utf8"))?;
    // Reuse the exported complete-XML/count/token/duplicate/ASCII validator;
    // its key policy is raw/v2, so translate only Key elements for validation.
    let translated = text.replace("<Key>index/v2/", "<Key>raw/v2/");
    let page = server2::storage::decode_list(translated.as_bytes(), 1000)?;
    let physical = format!("raw/v2/{namespace}");
    let keys = page
        .keys
        .into_iter()
        .map(|key| {
            key.strip_prefix(&physical)
                .filter(|s| s.ends_with(".json"))
                .map(|s| format!("index/v2/{s}"))
                .ok_or(Error::Corrupt("list escaped measurement namespace"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ListPage {
        keys,
        next: page.next,
    })
}

#[derive(Clone)]
pub struct Scoped {
    inner: Arc<HttpS3Transport>,
    prefix: Arc<str>,
    pub ledger: Arc<Ledger>,
    index: Arc<Index>,
    read_only: bool,
}
struct Index {
    bucket: rusty_s3::Bucket,
    credentials: rusty_s3::Credentials,
    client: reqwest::Client,
}
impl Scoped {
    pub fn new(
        inner: HttpS3Transport,
        prefix: String,
        ledger: Arc<Ledger>,
        bucket: &str,
        credentials: rusty_s3::Credentials,
    ) -> Result<Self, Error> {
        if !valid_prefix(&prefix) {
            return Err(Error::Invalid("exclusive measurement prefix"));
        }
        let bucket = rusty_s3::Bucket::new(
            "https://s3.ap-northeast-2.amazonaws.com/".parse().unwrap(),
            rusty_s3::UrlStyle::Path,
            bucket.to_owned(),
            "ap-northeast-2".to_owned(),
        )
        .map_err(|_| Error::Invalid("bucket"))?;
        let client = reqwest::Client::builder()
            .http1_max_headers(32)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .no_proxy()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .connect_timeout(Duration::from_secs(1))
            .timeout(Duration::from_secs(3))
            .pool_max_idle_per_host(16)
            .build()
            .map_err(|_| Error::Transport)?;
        Ok(Self {
            inner: Arc::new(inner),
            prefix: prefix.into(),
            ledger,
            index: Arc::new(Index {
                bucket,
                credentials,
                client,
            }),
            read_only: false,
        })
    }
    pub fn read_only(mut self) -> Self {
        self.read_only = true;
        self
    }
    fn key(&self, key: &str) -> Result<String, Error> {
        map(&self.prefix, key)
    }
}
impl ObjectTransport for Scoped {
    async fn ready(&self) -> Result<(), Error> {
        self.inner.ready().await
    }
    async fn put(&self, record: &PreparedRecord) -> Result<u16, Error> {
        if self.read_only {
            return Err(Error::Invalid("read-only continuation"));
        }
        let mut record = record.clone();
        record.key = self.key(&record.key)?;
        let p = self
            .ledger
            .reserve("put_raw", record.body.len() + HEADERS)?;
        let r = self.inner.put(&record).await;
        p.finish(
            record.body.len() + HEADERS,
            if r.is_ok() { "ok" } else { "error" },
        );
        r
    }
    async fn head(&self, key: &str) -> Result<Object, Error> {
        let key = self.key(key)?;
        let p = self.ledger.reserve("head_raw", HEADERS)?;
        let r = self.inner.head(&key).await;
        p.finish(HEADERS, if r.is_ok() { "ok" } else { "error" });
        r
    }
    async fn get(&self, key: &str, maximum: usize) -> Result<Object, Error> {
        let key = self.key(key)?;
        let p = self.ledger.reserve("get_raw", maximum + HEADERS)?;
        let r = self.inner.get(&key, maximum).await;
        let n = read_charge(&r, maximum, |o| o.body.len());
        p.finish(n, if r.is_ok() { "ok" } else { "error" });
        r
    }
}
impl CatalogTransport for Scoped {
    async fn get_control(&self, key: &str, maximum: usize) -> Result<ControlObject, Error> {
        let kind = if key.starts_with("index/v2/groups/") {
            "get_group"
        } else {
            "get_control"
        };
        let key = self.key(key)?;
        let p = self.ledger.reserve(kind, maximum + HEADERS)?;
        let r = self.inner.get_control(&key, maximum).await;
        let n = read_charge(&r, maximum, |o| o.body.len());
        p.finish(n, if r.is_ok() { "ok" } else { "error" });
        r
    }
    async fn put_control(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, Error> {
        if self.read_only {
            return Err(Error::Invalid("read-only continuation"));
        }
        let key = self.key(key)?;
        let p = self.ledger.reserve("put_control", body.len() + HEADERS)?;
        let r = self.inner.put_control(&key, body, condition).await;
        p.finish(body.len() + HEADERS, if r.is_ok() { "ok" } else { "error" });
        r
    }
    async fn list_raw_document(
        &self,
        prefix: &str,
        token: Option<&str>,
        keys: usize,
        maximum: usize,
    ) -> Result<Vec<u8>, Error> {
        let prefix = self.key(prefix)?;
        let p = self.ledger.reserve("list", maximum + HEADERS)?;
        let r = self
            .inner
            .list_raw_document(&prefix, token, keys, maximum)
            .await;
        let n = read_charge(&r, maximum, Vec::len);
        p.finish(n, if r.is_ok() { "ok" } else { "error" });
        let text = String::from_utf8(r?).map_err(|_| Error::Corrupt("measurement list utf8"))?;
        let mut text = text;
        for root in ["raw/v2/", "index/v2/", "budgets/v2/"] {
            text = text
                .replace(
                    &format!("<Key>{root}{}", self.prefix),
                    &format!("<Key>{root}"),
                )
                .replace(
                    &format!("<Prefix>{root}{}", self.prefix),
                    &format!("<Prefix>{root}"),
                );
        }
        Ok(text.into_bytes())
    }
}
impl IndexListing for Scoped {
    async fn list_index(&self, prefix: &str, token: Option<&str>) -> Result<ListPage, Error> {
        let key = self.key(prefix)?;
        let p = self
            .ledger
            .reserve("list_index", 8 * 1024 * 1024 + HEADERS)?;
        if token.is_some_and(|t| t.len() > 2048 || t.chars().any(char::is_control)) {
            return Err(Error::Invalid("list token"));
        }
        // Same signer/limits/XML decoder, separate instrumented client: the
        // native IndexListing interface otherwise hides actual consumed bytes.
        let result = async {
            let mut action = self
                .index
                .bucket
                .list_objects_v2(Some(&self.index.credentials));
            action.query_mut().remove("encoding-type");
            action.with_prefix(&key);
            action.with_max_keys(1000);
            if let Some(t) = token {
                action.with_continuation_token(t);
            }
            let mut reply = self
                .index
                .client
                .get(action.sign(Duration::from_secs(30)))
                .send()
                .await
                .map_err(|_| Error::Transport)?;
            if reply.status().as_u16() != 200 {
                return Err(Error::Status(reply.status().as_u16()));
            }
            if reply.headers().contains_key("content-encoding")
                || reply
                    .headers()
                    .iter()
                    .map(|(k, v)| k.as_str().len() + v.as_bytes().len())
                    .sum::<usize>()
                    > HEADERS
            {
                return Err(Error::Corrupt("list headers"));
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = reply.chunk().await.map_err(|_| Error::Transport)? {
                if chunk.len() > (8 * 1024 * 1024usize).saturating_sub(bytes.len()) {
                    return Err(Error::Corrupt("list size"));
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(bytes)
        }
        .await;
        let n = read_charge(&result, 8 * 1024 * 1024, Vec::len);
        p.finish(n, if result.is_ok() { "ok" } else { "error" });
        index_page(&result?, &self.prefix)
    }
}
fn budget_error(e: Error) -> BudgetError {
    match e {
        Error::NotFound => BudgetError::NotFound,
        Error::Status(n) => BudgetError::Status(n),
        _ => BudgetError::Transport,
    }
}
impl BudgetTransport for Scoped {
    async fn get_budget(&self, key: &str) -> Result<BudgetObject, BudgetError> {
        let key = self.key(key).map_err(budget_error)?;
        let p = self
            .ledger
            .reserve("get_budget", 4096 + HEADERS)
            .map_err(budget_error)?;
        let r = self.inner.get_budget(&key).await;
        let n = r
            .as_ref()
            .map(|o| o.body.len() + HEADERS)
            .unwrap_or(4096 + HEADERS);
        p.finish(n, if r.is_ok() { "ok" } else { "error" });
        r
    }
    async fn put_budget(
        &self,
        key: &str,
        body: &[u8],
        condition: &WriteCondition,
    ) -> Result<u16, BudgetError> {
        if self.read_only {
            return Err(BudgetError::Invalid("read-only continuation"));
        }
        let key = self.key(key).map_err(budget_error)?;
        let p = self
            .ledger
            .reserve("put_budget", body.len() + HEADERS)
            .map_err(budget_error)?;
        let r = self.inner.put_budget(&key, body, condition).await;
        p.finish(body.len() + HEADERS, if r.is_ok() { "ok" } else { "error" });
        r
    }
}
pub struct Funded {
    pub inner: HttpProviderTransport,
    pub ledger: Arc<Ledger>,
}
impl ProviderTransport for Funded {
    async fn send(&self, r: &Request) -> Result<ProviderResponse, ProviderTransportError> {
        let p = self
            .ledger
            .reserve("provider", RESPONSE + HEADERS)
            .map_err(|_| ProviderTransportError::Invalid)?;
        let out = self.inner.send(r).await;
        let n = out
            .as_ref()
            .map(|r| r.body.len() + HEADERS)
            .unwrap_or(RESPONSE + HEADERS);
        p.finish(
            n,
            if out.is_ok() {
                "response"
            } else {
                "transport_error"
            },
        );
        out
    }
}
pub struct Public {
    pub inner: HttpPublicTransport,
    pub ledger: Arc<Ledger>,
}
impl PublicTransport for Public {
    async fn fetch(&self, r: &PublicRequest) -> Result<ProviderResponse, ProviderTransportError> {
        let p = self
            .ledger
            .reserve("provider", RESPONSE + HEADERS)
            .map_err(|_| ProviderTransportError::Invalid)?;
        let out = self.inner.fetch(r).await;
        let n = out
            .as_ref()
            .map(|r| r.body.len() + HEADERS)
            .unwrap_or(RESPONSE + HEADERS);
        p.finish(
            n,
            if out.is_ok() {
                "response"
            } else {
                "transport_error"
            },
        );
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_namespace_escape_and_nonowned_prefix() {
        assert!(!valid_prefix("raw/v2/"));
        assert!(!valid_prefix("verification/kma-20261024-x/../"));
        let p = "verification/kma-20261024-test/";
        assert!(valid_prefix(p));
        assert!(map(p, "../raw/v2/x").is_err());
        assert!(map(p, "/raw/v2/x").is_err());
        assert!(map(p, "raw//x").is_err());
        assert_eq!(map(p, "raw/v2/a").unwrap(), format!("raw/v2/{p}a"));
        assert!(map(p, "production/control/x").is_err());
    }
    #[test]
    fn denied_call_never_receives_admission_and_cancel_charges_full_bound() {
        let l = Ledger::new();
        let p = l.reserve("provider", RESPONSE).unwrap();
        drop(p);
        assert_eq!(l.snapshot()["conservative_body_and_header_bytes"], RESPONSE);
        for _ in 1..64 {
            l.reserve("provider", 1).unwrap().finish(1, "ok");
        }
        assert!(l.reserve("provider", 1).is_err());
        assert_eq!(l.snapshot()["admitted"]["provider"], 64);
    }
    #[test]
    fn index_listing_restores_logical_keys_and_rejects_a_foreign_namespace() {
        let ns = "verification/kma-20261024-test/";
        let xml = |ns: &str| {
            format!(
                r#"<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated><KeyCount>1</KeyCount><Contents><Key>index/v2/{ns}data-go-kr/kind/key/day.json</Key></Contents></ListBucketResult>"#
            )
        };
        assert_eq!(
            index_page(xml(ns).as_bytes(), ns).unwrap().keys,
            vec!["index/v2/data-go-kr/kind/key/day.json"]
        );
        assert!(index_page(xml("foreign/").as_bytes(), ns).is_err());
        assert!(index_page(xml(ns).replace("<KeyCount>1", "<KeyCount>2").as_bytes(), ns).is_err());
    }
    #[test]
    fn continuation_carries_prior_charges_and_rejects_unsettled_parent() {
        let original = Ledger::new();
        original.reserve("provider", 100).unwrap().finish(100, "ok");
        let parent = original.snapshot();
        let resumed = Ledger::resume(&parent, Duration::from_secs(10)).unwrap();
        assert_eq!(resumed.snapshot()["admitted"]["provider"], 1);
        assert_eq!(
            resumed.snapshot()["conservative_body_and_header_bytes"],
            100
        );
        let mut bad = parent;
        bad["inflight_reserved_bytes"] = json!(1);
        assert!(Ledger::resume(&bad, Duration::from_secs(10)).is_err());
    }
}
