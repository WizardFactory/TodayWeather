//! data.go.kr `WthrWrnInfoService` requests ported from `server/lib/kmaWarningRequester.js`
//! (ca8735cf). Funding, key rotation and rejection classes use the S08 executor.
use super::js;
use crate::{
    budget::{BudgetStore, BudgetTransport, Clock, Provider},
    providers::{
        AcquisitionError, AcquisitionOutcome, Candidate, Disposition, FundedExecutor,
        HttpProviderTransport, ProviderKey, ProviderTransport,
    },
};
use serde_json::Value;
use std::{future::Future, pin::Pin, sync::Arc};
use tokio::time::Instant;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
/// Legacy used `http://`; S08 transport only permits HTTPS for non-loopback providers.
pub const BASE_URL: &str = "https://apis.data.go.kr/1360000/WthrWrnInfoService/";
pub const NATIONWIDE_STN_ID: &str = "108";
pub const PAGE_ROWS: u32 = 1000;
pub const MAX_PAGES: u32 = 20;
pub const ZONE_PAGE_ROWS: u32 = 10000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Operation {
    PwnStatus,
    WrnMsg,
    PwnCd,
    WthrPwn,
    WthrInfo,
    BrkNews,
}
impl Operation {
    pub fn name(self) -> &'static str {
        match self {
            Self::PwnStatus => "getPwnStatus",
            Self::WrnMsg => "getWthrWrnMsg",
            Self::PwnCd => "getPwnCd",
            Self::WthrPwn => "getWthrPwn",
            Self::WthrInfo => "getWthrInfo",
            Self::BrkNews => "getWthrBrkNews",
        }
    }
    /// Role recorded in the raw record content type.
    pub fn role(self) -> &'static str {
        match self {
            Self::PwnStatus => "pwn-status",
            Self::WrnMsg => "wrn-msg",
            Self::PwnCd => "pwn-cd",
            Self::WthrPwn => "wthr-pwn",
            Self::WthrInfo => "wthr-info",
            Self::BrkNews => "brk-news",
        }
    }
    pub fn all() -> [Self; 6] {
        [
            Self::PwnStatus,
            Self::WrnMsg,
            Self::PwnCd,
            Self::WthrPwn,
            Self::WthrInfo,
            Self::BrkNews,
        ]
    }
}
/// One successful provider page with its exact bytes.
#[derive(Clone, Debug)]
pub struct Page {
    pub operation: Operation,
    pub body: Arc<[u8]>,
    pub fetched_at_ms: u64,
    pub items: Vec<Value>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FetchError {
    Quota,
    Auth,
    Rejected,
    Transport,
    Deadline,
    Invalid,
    TooManyPages,
}
impl FetchError {
    pub fn is_quota(self) -> bool {
        self == Self::Quota
    }
}
/// `classify(...)` item extraction for an accepted page; `None` means no data.
pub fn items(body: &[u8]) -> Result<Option<Vec<Value>>, FetchError> {
    let value: Value = serde_json::from_slice(body).map_err(|_| FetchError::Rejected)?;
    if value.get("OpenAPI_ServiceResponse").is_some() {
        return Err(FetchError::Rejected);
    }
    let header = value
        .get("response")
        .and_then(|r| r.get("header"))
        .ok_or(FetchError::Rejected)?;
    let code = js::string(header.get("resultCode"));
    if code == "03" {
        return Ok(None);
    }
    if code != "00" && code != "0" {
        return Err(FetchError::Rejected);
    }
    let item = value
        .get("response")
        .and_then(|r| r.get("body"))
        .and_then(|b| b.get("items"))
        .and_then(|i| i.get("item"));
    match item {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Ok(None),
        Some(Value::Array(a)) if a.is_empty() => Ok(None),
        Some(Value::Array(a)) => Ok(Some(a.clone())),
        Some(other) => Ok(Some(vec![other.clone()])),
    }
}
/// Valid accepted JSON for the S08 executor: an object with a success/no-data header.
pub fn valid(value: &Value) -> bool {
    value
        .get("response")
        .and_then(|r| r.get("header"))
        .is_some_and(|h| matches!(js::string(h.get("resultCode")).as_str(), "00" | "0" | "03"))
}
/// `latestItem(items)`: greatest `(tmFc, tmSeq)`; stable like V8 TimSort.
pub fn latest_item(items: &[Value]) -> Option<&Value> {
    let mut sorted: Vec<&Value> = items.iter().collect();
    sorted.sort_by(|a, b| {
        let seq = |v: &Value| {
            let s = v.get("tmSeq");
            if js::truthy(s) { js::number(s) } else { 0. }
        };
        js::order(js::chain(&[
            js::number(b.get("tmFc")) - js::number(a.get("tmFc")),
            seq(b) - seq(a),
        ]))
    });
    sorted.first().copied()
}
/// `announcementOf(tmFc)`: KST wall clock stored as a UTC instant (ms).
pub fn announcement_of(tm_fc: Option<&Value>) -> Option<i64> {
    let s: Vec<u16> = js::utf16(&js::string(tm_fc));
    let part = |a: usize, b: usize| -> f64 {
        let a = a.min(s.len());
        let b = b.min(s.len());
        js::number_str(&String::from_utf16_lossy(&s[a..b]))
    };
    let ms = js::date_utc(
        part(0, 4),
        part(4, 6) - 1.,
        part(6, 8),
        part(8, 10),
        part(10, 12),
    );
    if ms.is_nan() { None } else { Some(ms as i64) }
}
/// `kstDate(date, offsetDays)` as YYYYMMDD.
pub fn kst_date(now_ms: i64, offset_days: i64) -> u32 {
    js::ymd(now_ms + 9 * 3_600_000 + offset_days * 86_400_000)
}
/// Recorded-fixture and funded-provider sources implement one page request.
pub trait WarningSource: Send + Sync {
    /// `Ok(None)` is the provider's no-data answer (resultCode 03 or empty items).
    fn fetch<'a>(
        &'a self,
        operation: Operation,
        params: Vec<(&'static str, String)>,
        deadline: Instant,
    ) -> BoxFuture<'a, Result<Option<Page>, FetchError>>;
}
/// `getAll`: every page until a short page, at most `MAX_PAGES`.
pub async fn get_all<S: WarningSource + ?Sized>(
    source: &S,
    operation: Operation,
    params: Vec<(&'static str, String)>,
    page_rows: u32,
    deadline: Instant,
) -> Result<Vec<Page>, FetchError> {
    let mut pages = Vec::new();
    for page_no in 1..=MAX_PAGES {
        let mut query = params.clone();
        query.push(("pageNo", page_no.to_string()));
        query.push(("numOfRows", page_rows.to_string()));
        let Some(page) = source.fetch(operation, query, deadline).await? else {
            return Ok(pages);
        };
        let short = page.items.len() < page_rows as usize;
        pages.push(page);
        if short {
            return Ok(pages);
        }
    }
    Err(FetchError::TooManyPages)
}
/// Funded data.go.kr source on the S08 executor. Keys are injected by the operator.
pub struct FundedSource<T, P = HttpProviderTransport> {
    executor: FundedExecutor<P, fn(&Value) -> bool>,
    base: reqwest::Url,
    candidates: Vec<(Arc<BudgetStore<T>>, String)>,
    clock: Arc<dyn Clock>,
}
impl<T: BudgetTransport, P: ProviderTransport> FundedSource<T, P> {
    pub fn new(
        transport: Arc<P>,
        base: &str,
        candidates: Vec<(Arc<BudgetStore<T>>, String)>,
        clock: Arc<dyn Clock>,
    ) -> Result<Self, FetchError> {
        let base = reqwest::Url::parse(base).map_err(|_| FetchError::Invalid)?;
        if candidates.is_empty() || candidates.len() > 2 || !base.path().ends_with('/') {
            return Err(FetchError::Invalid);
        }
        let validator: fn(&Value) -> bool = valid;
        let executor = FundedExecutor::new(Provider::DataGoKr, 1, transport, Arc::new(validator))
            .map_err(|_| FetchError::Invalid)?;
        Ok(Self {
            executor,
            base,
            candidates,
            clock,
        })
    }
}
fn map_error(e: AcquisitionError) -> FetchError {
    match e {
        AcquisitionError::Provider(Disposition::Quota) => FetchError::Quota,
        AcquisitionError::Provider(Disposition::Auth) => FetchError::Auth,
        AcquisitionError::Provider(_) => FetchError::Rejected,
        AcquisitionError::Deadline => FetchError::Deadline,
        AcquisitionError::Funding(_) | AcquisitionError::Invalid => FetchError::Invalid,
        AcquisitionError::Transport => FetchError::Transport,
    }
}
impl<T: BudgetTransport + 'static, P: ProviderTransport + 'static> WarningSource
    for FundedSource<T, P>
{
    fn fetch<'a>(
        &'a self,
        operation: Operation,
        params: Vec<(&'static str, String)>,
        deadline: Instant,
    ) -> BoxFuture<'a, Result<Option<Page>, FetchError>> {
        Box::pin(async move {
            let mut url = self
                .base
                .join(operation.name())
                .map_err(|_| FetchError::Invalid)?;
            {
                let mut q = url.query_pairs_mut();
                for (k, v) in &params {
                    q.append_pair(k, v);
                }
            }
            let mut candidates = Vec::new();
            for (budget, key) in &self.candidates {
                candidates.push(Candidate {
                    budget: budget.clone(),
                    key: ProviderKey::new(key.clone()).map_err(|_| FetchError::Invalid)?,
                });
            }
            let outcome = self
                .executor
                .execute(url, candidates, deadline)
                .await
                .map_err(map_error)?;
            let fetched_at_ms = self
                .clock
                .now_ms()
                .ok()
                .and_then(|n| u64::try_from(n).ok())
                .ok_or(FetchError::Invalid)?;
            match outcome {
                AcquisitionOutcome::NoData(_) => Ok(None),
                AcquisitionOutcome::Data(raw) => match items(&raw.body)? {
                    None => Ok(None),
                    Some(items) => Ok(Some(Page {
                        operation,
                        body: raw.body.into(),
                        fetched_at_ms,
                        items,
                    })),
                },
            }
        })
    }
}
