//! Summary revisions in S3. A revision is written once (`If-None-Match: *`) and never deleted;
//! the newest is the greatest object name under its date prefix whose body verifies.
use super::transport::SummaryTransport;
use super::{ObjectName, Summary, SummaryKey};
use crate::storage::Error;
use tokio::time::{Instant, timeout_at};

/// LIST pages read for one date prefix (1,000 keys each); a longer listing is an error.
const LIST_PAGES: usize = 8;

/// A stored revision and its object name.
#[derive(Debug, Clone, PartialEq)]
pub struct Stored {
    pub name: ObjectName,
    pub summary: Summary,
}

pub struct SummaryStore<T> {
    transport: T,
}
impl<T: SummaryTransport> SummaryStore<T> {
    pub fn new(transport: T) -> Self {
        Self { transport }
    }
    pub fn transport(&self) -> &T {
        &self.transport
    }
    /// Revision object names of one date, greatest first.
    pub async fn names(
        &self,
        key: &SummaryKey,
        date: u32,
        deadline: Instant,
    ) -> Result<Vec<(String, ObjectName)>, Error> {
        let prefix = key.date_prefix(date);
        let mut token: Option<String> = None;
        let mut out = Vec::new();
        for _ in 0..LIST_PAGES {
            let page = timeout_at(
                deadline,
                self.transport.list_summary(&prefix, token.as_deref()),
            )
            .await
            .map_err(|_| Error::Timeout)??;
            for k in page.keys {
                let name = k.strip_prefix(&prefix).unwrap_or_default().to_owned();
                // Another layout or a foreign object under the prefix is not a revision.
                if let Some(parsed) = ObjectName::parse(&name) {
                    out.push((name, parsed));
                }
            }
            match page.next {
                Some(next) if Some(&next) != token.as_ref() => token = Some(next),
                Some(_) => return Err(Error::Corrupt("summary list token")),
                None => {
                    out.sort_by(|a, b| b.1.cmp(&a.1));
                    return Ok(out);
                }
            }
        }
        Err(Error::Capacity)
    }
    /// The newest verified revision of one date, or None. A body that does not verify is
    /// skipped (the next older revision is read).
    pub async fn newest(
        &self,
        key: &SummaryKey,
        date: u32,
        deadline: Instant,
    ) -> Result<Option<Stored>, Error> {
        let prefix = key.date_prefix(date);
        for (name, parsed) in self.names(key, date, deadline).await? {
            let body = timeout_at(
                deadline,
                self.transport.get_summary(&format!("{prefix}{name}")),
            )
            .await
            .map_err(|_| Error::Timeout)??;
            let Some(body) = body else {
                continue;
            };
            if let Some(summary) = Summary::parse(&body, key, date, &name) {
                return Ok(Some(Stored {
                    name: parsed,
                    summary,
                }));
            }
        }
        Ok(None)
    }
    /// Create the revision. An existing object counts only when its bytes are identical.
    pub async fn publish(&self, summary: &Summary, deadline: Instant) -> Result<(), Error> {
        let key = summary.object_key();
        let body = summary.body();
        let status = timeout_at(deadline, self.transport.put_summary(&key, &body))
            .await
            .map_err(|_| Error::Ambiguous)?;
        let status = match status {
            Ok(s) => s,
            // An unknown outcome is reconciled by reading the object back.
            Err(Error::Ambiguous) => 412,
            Err(e) => return Err(e),
        };
        match status {
            200 => Ok(()),
            412 => {
                let stored = timeout_at(deadline, self.transport.get_summary(&key))
                    .await
                    .map_err(|_| Error::Ambiguous)??;
                match stored {
                    Some(b) if b == body => Ok(()),
                    Some(_) => Err(Error::Corrupt("summary revision differs")),
                    None => Err(Error::Ambiguous),
                }
            }
            s => Err(Error::Status(s)),
        }
    }
}
