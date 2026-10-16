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
    }

    /// Record the minute's outcomes (best effort; a failure leaves the claim without result,
    /// which reads as "outcomes unknown").
    pub async fn result(&self, kind: &str, minute_ms: i64, body: &serde_json::Value) -> bool {
        let key = format!("{}.result.json", minute_path(kind, minute_ms));
        let bytes = serde_json::to_vec(body).expect("result json");
        matches!(
            self.bounded(
                self.transport
                    .put_control(&key, &bytes, &WriteCondition::Absent)
            )
            .await,
            Ok(200)
        )
    }
}
