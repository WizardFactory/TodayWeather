//! Delivery ledger in S3. A scheduled minute is claimed (`If-None-Match: *`) with the `_id`s it
//! will deliver before any send, so a restart, a second process or a repeated tick never sends
//! the same delivery again (D02); the minute's per-delivery outcomes follow in a result object.
//! The identity of a delivery is (kind, minute, record `_id`). Objects hold `_id`s, outcome
//! classes and HTTP statuses only: no token, name, coordinate or message text.
use crate::push::durable::nonce;
use crate::storage::{CatalogTransport, Error, WriteCondition};
use std::time::Duration;

const PREFIX: &str = "index/v2/push/delivery";
const MAX_OBJECT: usize = 8 * 1024 * 1024;

/// `alarm/{YYYYMMDD}/{HHMM}` of a UTC minute (ms).
pub fn minute_path(kind: &str, minute_ms: i64) -> String {
    let p = crate::world::js::parts(minute_ms as f64).expect("valid minute");
    format!(
        "{PREFIX}/{kind}/{:04}{:02}{:02}/{:02}{:02}",
        p.year, p.month, p.day, p.hour, p.minute
    )
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Claim {
    /// This process owns the minute.
    Owned,
    /// The minute was already claimed (by this or another process): nothing is sent.
    Taken,
    /// The claim could not be made durable: nothing is sent.
    Unavailable,
}

/// Whether the minute's result object was stored.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Written {
    Recorded,
    /// Not stored (refused, or read back as absent or different).
    Refused,
    /// The write's outcome and the read-back failed.
    Unknown,
}

pub struct Ledger<T> {
    transport: std::sync::Arc<T>,
    deadline: Duration,
}

impl<T: CatalogTransport + Send + Sync + 'static> Ledger<T> {
    pub fn new(transport: std::sync::Arc<T>, deadline: Duration) -> Self {
        Self {
            transport,
            deadline,
        }
    }
    async fn bounded<F, R>(&self, f: F) -> Result<R, Error>
    where
        F: std::future::Future<Output = Result<R, Error>>,
    {
        tokio::time::timeout(self.deadline, f)
            .await
            .unwrap_or(Err(Error::Timeout))
    }

    /// Claim `kind`/`minute` for the listed `_id`s.
    pub async fn claim(&self, kind: &str, minute_ms: i64, now_ms: i64, ids: &[String]) -> Claim {
        use crate::observability::{Action, Cause, Component, Details, Operation, Outcome, Stage};
        let mut operation = Operation::new(Component::Delivery, Stage::Claim);
        operation.external_pending();
        let context = operation.context();
        let outcome = context
            .scope(async {
                let key = format!("{}.json", minute_path(kind, minute_ms));
                let body = serde_json::to_vec(&serde_json::json!({
                    "schema": 1,
                    "kind": kind,
                    "minute": crate::world::js::iso(minute_ms as f64),
                    "claimedAt": crate::world::js::iso(now_ms as f64),
                    "claim": nonce(),
                    "records": ids,
                }))
                .expect("claim json");
                if self.bounded(self.transport.ready()).await.is_err() {
                    return Claim::Unavailable;
                }
                match self
                    .bounded(
                        self.transport
                            .put_control(&key, &body, &WriteCondition::Absent),
                    )
                    .await
                {
                    Ok(200) => Claim::Owned,
                    Ok(409 | 412) => Claim::Taken,
                    Ok(status) if (400..500).contains(&status) => Claim::Unavailable,
                    // Unknown outcome: read it back; only our own body is a claim.
                    _ => match self
                        .bounded(self.transport.get_control(&key, MAX_OBJECT))
                        .await
                    {
                        Ok(object) if object.body == body => Claim::Owned,
                        Ok(_) => Claim::Taken,
                        Err(_) => Claim::Unavailable,
                    },
                }
            })
            .await;
        let (cause, action, result) = match &outcome {
            Claim::Owned => (Cause::None, Action::None, Outcome::Success),
            Claim::Taken => (Cause::ClaimExists, Action::DoNotRetry, Outcome::Skipped),
            Claim::Unavailable => (Cause::Dependency, Action::DoNotRetry, Outcome::Unknown),
        };
        operation.finish(
            cause,
            action,
            result,
            Details {
                count: Some(ids.len() as u64),
                ..Details::default()
            },
        );
        outcome
    }

    /// Record the minute's outcomes (best effort; a missing result leaves the claim without
    /// result, which reads as "outcomes unknown"). An unknown write outcome is read back.
    pub async fn result(&self, kind: &str, minute_ms: i64, body: &serde_json::Value) -> Written {
        use crate::observability::{Action, Cause, Component, Details, Operation, Outcome, Stage};
        let mut operation = Operation::new(Component::Delivery, Stage::RecordResult);
        operation.external_pending();
        let context = operation.context();
        let outcome = context
            .scope(async {
                let key = format!("{}.result.json", minute_path(kind, minute_ms));
                let bytes = serde_json::to_vec(body).expect("result json");
                match self
                    .bounded(
                        self.transport
                            .put_control(&key, &bytes, &WriteCondition::Absent),
                    )
                    .await
                {
                    Ok(200) => Written::Recorded,
                    Ok(status) if (400..500).contains(&status) => Written::Refused,
                    _ => match self
                        .bounded(self.transport.get_control(&key, MAX_OBJECT))
                        .await
                    {
                        Ok(object) if object.body == bytes => Written::Recorded,
                        Ok(_) => Written::Refused,
                        Err(Error::NotFound) => Written::Refused,
                        Err(_) => Written::Unknown,
                    },
                }
            })
            .await;
        let (cause, action, result) = match &outcome {
            Written::Recorded => (Cause::None, Action::None, Outcome::Success),
            Written::Refused => (Cause::Dependency, Action::RetainClaim, Outcome::Failed),
            Written::Unknown => (Cause::Ambiguous, Action::RetainClaim, Outcome::Unknown),
        };
        let count = body
            .get("deliveries")
            .and_then(serde_json::Value::as_array)
            .map(|items| items.len() as u64)
            .or_else(|| body.get("outcome").map(|_| 1));
        operation.finish(
            cause,
            action,
            result,
            Details {
                count,
                ..Details::default()
            },
        );
        outcome
    }
}
