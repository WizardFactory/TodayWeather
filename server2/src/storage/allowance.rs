//! Opt-in qualification allowance. The coordinator consumes each process generation's
//! allocation durably before launch. This process never refunds a physical attempt.
use super::Error;
use std::sync::{
    Arc, Mutex, OnceLock,
    atomic::{AtomicU64, Ordering},
};

pub const SETTING: &str = "SERVER2_SHADOW_S3_LIMITS";
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Counts {
    pub reads: u64,
    pub writes: u64,
    pub put_bytes: u64,
}
#[derive(Clone, Copy)]
pub(crate) enum Attempt {
    Read,
    List,
    Put(usize),
}
pub struct Allowance {
    initial: Counts,
    remaining: Mutex<Counts>,
}
impl Allowance {
    pub fn new(counts: Counts) -> Result<Self, Error> {
        if counts.reads > 900_000
            || counts.writes > 900_000
            || counts.put_bytes > 2 * 1024 * 1024 * 1024
        {
            return Err(Error::Invalid("shadow S3 allowance"));
        }
        Ok(Self {
            initial: counts,
            remaining: Mutex::new(counts),
        })
    }
    pub fn remaining(&self) -> Result<Counts, Error> {
        self.remaining
            .lock()
            .map(|v| *v)
            .map_err(|_| Error::Capacity)
    }
    pub(crate) fn admit(&self, attempt: Attempt) -> Result<(), Error> {
        let mut held = self.remaining.lock().map_err(|_| Error::Capacity)?;
        let mut next = *held;
        match attempt {
            Attempt::Read => next.reads = next.reads.checked_sub(1).ok_or(Error::Capacity)?,
            Attempt::List => next.writes = next.writes.checked_sub(1).ok_or(Error::Capacity)?,
            Attempt::Put(bytes) => {
                next.writes = next.writes.checked_sub(1).ok_or(Error::Capacity)?;
                next.put_bytes = next
                    .put_bytes
                    .checked_sub(u64::try_from(bytes).map_err(|_| Error::Capacity)?)
                    .ok_or(Error::Capacity)?;
            }
        }
        *held = next;
        Ok(())
    }
}
static PROCESS: OnceLock<Option<Arc<Allowance>>> = OnceLock::new();
fn parse(value: Option<String>) -> Result<Option<Counts>, Error> {
    let Some(value) = value else { return Ok(None) };
    let parts: Vec<_> = value.split(',').collect();
    if parts.len() != 3
        || parts
            .iter()
            .any(|v| v.is_empty() || !v.bytes().all(|c| c.is_ascii_digit()))
    {
        return Err(Error::Invalid("shadow S3 allowance"));
    }
    let numbers: Result<Vec<u64>, _> = parts.iter().map(|v| v.parse()).collect();
    let n = numbers.map_err(|_| Error::Invalid("shadow S3 allowance"))?;
    let counts = Counts {
        reads: n[0],
        writes: n[1],
        put_bytes: n[2],
    };
    Allowance::new(counts)?;
    Ok(Some(counts))
}
/// Call once in the qualified server executable, before runtime construction.
/// Reinstalling the same settings does not replenish spend. Conflicting settings fail.
pub fn install_process(var: &dyn Fn(&str) -> Option<String>) -> Result<(), Error> {
    let requested = parse(var(SETTING))?;
    let new = requested.map(Allowance::new).transpose()?.map(Arc::new);
    let installed = PROCESS.get_or_init(|| new);
    if installed.as_ref().map(|a| a.initial) != requested {
        return Err(Error::Invalid("shadow S3 allowance already installed"));
    }
    Ok(())
}
pub(crate) fn process() -> Option<&'static Arc<Allowance>> {
    PROCESS.get().and_then(Option::as_ref)
}

static AUTH_FAILURES: AtomicU64 = AtomicU64::new(0);
static QUOTA_FAILURES: AtomicU64 = AtomicU64::new(0);
/// Sticky stop signals, recorded before best-effort logging can discard an event.
/// These count classified events, not provider requests or billable usage.
pub(crate) fn observe_rejection(cause: crate::observability::Cause) {
    if process().is_none() {
        return;
    }
    let counter = match cause {
        crate::observability::Cause::Auth => &AUTH_FAILURES,
        crate::observability::Cause::Quota => &QUOTA_FAILURES,
        _ => return,
    };
    let _ = counter.try_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
        Some(n.saturating_add(1))
    });
}
pub(crate) fn render_metrics() -> String {
    let Some(allowance) = process() else {
        return String::new();
    };
    // A poisoned owner cannot be trusted; zero causes the host guard to stop.
    let left = allowance.remaining().unwrap_or(Counts {
        reads: 0,
        writes: 0,
        put_bytes: 0,
    });
    format!(
        "server2_shadow_s3_reads_remaining {}\nserver2_shadow_s3_writes_remaining {}\nserver2_shadow_s3_put_bytes_remaining {}\nserver2_runtime_auth_failures_total {}\nserver2_runtime_quota_failures_total {}\n",
        left.reads,
        left.writes,
        left.put_bytes,
        AUTH_FAILURES.load(Ordering::Relaxed),
        QUOTA_FAILURES.load(Ordering::Relaxed)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_optional_setting() {
        assert_eq!(parse(None).unwrap(), None);
        assert_eq!(
            parse(Some("0,0,0".into())).unwrap(),
            Some(Counts {
                reads: 0,
                writes: 0,
                put_bytes: 0
            })
        );
        for bad in [
            "",
            "1,2",
            "1,2,3,4",
            "-1,2,3",
            "+1,2,3",
            "1, 2,3",
            "900001,0,0",
            "0,0,2147483649",
            "9999999999999999999999,0,0",
        ] {
            assert!(parse(Some(bad.into())).is_err(), "{bad}");
        }
    }
    #[test]
    fn compound_admission_does_not_partially_spend() {
        let a = Allowance::new(Counts {
            reads: 1,
            writes: 2,
            put_bytes: 4,
        })
        .unwrap();
        assert_eq!(a.admit(Attempt::Put(5)), Err(Error::Capacity));
        assert_eq!(a.remaining().unwrap(), a.initial);
        a.admit(Attempt::Put(4)).unwrap();
        a.admit(Attempt::List).unwrap();
        assert_eq!(a.admit(Attempt::List), Err(Error::Capacity));
        a.admit(Attempt::Read).unwrap();
        assert_eq!(a.admit(Attempt::Read), Err(Error::Capacity));
    }
    #[test]
    fn concurrent_last_reservation_has_one_winner() {
        let a = Arc::new(
            Allowance::new(Counts {
                reads: 1,
                writes: 1,
                put_bytes: 1,
            })
            .unwrap(),
        );
        let workers: Vec<_> = (0..32)
            .map(|_| {
                let a = a.clone();
                std::thread::spawn(move || a.admit(Attempt::Put(1)).is_ok())
            })
            .collect();
        assert_eq!(
            workers
                .into_iter()
                .map(|w| usize::from(w.join().unwrap()))
                .sum::<usize>(),
            1
        );
    }
}

#[cfg(test)]
mod wire_tests {
    //! Loopback coverage for all fourteen physical sends and their shared LIST callers.
    use crate::budget::BudgetTransport;
    use crate::geocode::{
        AddressProjection, AddressStore, GeoClient, Location, storage::S3AddressStore,
    };
    use crate::history::{demand::DemandTransport, transport::IndexListing};
    use crate::storage::allowance::{Allowance, Counts};
    use crate::storage::{
        CatalogTransport, HttpS3Transport, ObjectTransport, PreparedRecord, WriteCondition,
    };
    use crate::summary::transport::SummaryTransport;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    #[tokio::test]
    async fn process_owner_case() {
        if std::env::var_os("SHADOW_ALLOWANCE_CHILD").is_none() {
            return;
        }
        use super::{Attempt, install_process};
        let vars = |_: &str| Some("1,0,0".to_owned());
        install_process(&vars).unwrap();
        let new = || {
            HttpS3Transport::new(
                "http://127.0.0.1:9",
                "owned-records",
                "ap-northeast-2",
                rusty_s3::Credentials::new("local", "local-secret"),
            )
            .unwrap()
        };
        let first = new();
        first.admit(Attempt::Read).unwrap();
        install_process(&vars).unwrap();
        let mut second = new();
        second.test_allowance = Some(Arc::new(
            Allowance::new(Counts {
                reads: 100,
                writes: 100,
                put_bytes: 100,
            })
            .unwrap(),
        ));
        assert_eq!(
            second.admit(Attempt::Read),
            Err(crate::storage::Error::Capacity)
        );
        assert!(install_process(&|_| Some("2,0,0".into())).is_err());
        assert!(install_process(&|_| None).is_err());
    }

    #[test]
    fn additional_transport_and_reinstallation_cannot_replenish_process() {
        let result = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "storage::allowance::wire_tests::process_owner_case",
                "--nocapture",
            ])
            .env("SHADOW_ALLOWANCE_CHILD", "1")
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }

    #[test]
    fn guard_metrics_case() {
        use crate::observability::{
            self as obs, Action, Cause, Component, Details, Outcome, Stage,
        };
        if std::env::var("SHADOW_METRICS_CHILD").as_deref() != Ok("1") {
            return;
        }
        assert!(!obs::render_metrics().contains("server2_shadow_"));
        super::install_process(&|_| Some("2,3,8".into())).unwrap();
        super::process()
            .unwrap()
            .admit(super::Attempt::Put(5))
            .unwrap();
        // The log threshold suppresses these warning records; guard signals must survive.
        obs::init(&|key| {
            if key == "SERVER2_LOG_LEVEL" {
                Some("error".into())
            } else {
                None
            }
        });
        for cause in [Cause::Auth, Cause::Quota] {
            obs::event(
                Component::Provider,
                Stage::Acquire,
                cause,
                Action::DoNotRetry,
                Outcome::Failed,
                Details::default(),
            );
        }
        let metrics = obs::render_metrics();
        for line in [
            "server2_shadow_s3_reads_remaining 2",
            "server2_shadow_s3_writes_remaining 2",
            "server2_shadow_s3_put_bytes_remaining 3",
            "server2_runtime_auth_failures_total 1",
            "server2_runtime_quota_failures_total 1",
        ] {
            assert!(
                metrics.lines().any(|got| got == line),
                "missing {line}: {metrics}"
            );
        }
        super::install_process(&|_| Some("2,3,8".into())).unwrap();
        assert_eq!(obs::render_metrics(), metrics);
    }
    #[test]
    fn guard_metrics_survive_log_filter_without_reset() {
        let result = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "storage::allowance::wire_tests::guard_metrics_case",
                "--nocapture",
            ])
            .env("SHADOW_METRICS_CHILD", "1")
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{} {}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
    }

    #[tokio::test]
    async fn cancelled_inflight_attempt_is_not_refunded() {
        let reached = Arc::new(tokio::sync::Notify::new());
        let signal = reached.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let app = axum::Router::new().fallback(move || {
            let signal = signal.clone();
            async move {
                signal.notify_one();
                std::future::pending::<axum::http::StatusCode>().await
            }
        });
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let a = Arc::new(
            Allowance::new(Counts {
                reads: 1,
                writes: 0,
                put_bytes: 0,
            })
            .unwrap(),
        );
        let mut t = HttpS3Transport::new(
            &endpoint,
            "owned-records",
            "ap-northeast-2",
            rusty_s3::Credentials::new("local", "local-secret"),
        )
        .unwrap();
        t.test_allowance = Some(a.clone());
        let t = Arc::new(t);
        let other = t.clone();
        let request = tokio::spawn(async move { other.get("raw/v2/test", 1024).await });
        tokio::time::timeout(std::time::Duration::from_secs(2), reached.notified())
            .await
            .unwrap();
        request.abort();
        let _ = request.await;
        assert_eq!(a.remaining().unwrap().reads, 0);
        assert!(matches!(
            t.get("raw/v2/test", 1024).await,
            Err(crate::storage::Error::Capacity)
        ));
        server.abort();
    }

    #[tokio::test]
    async fn redirects_server_failures_and_conflicts_do_not_trigger_hidden_retries() {
        for status in [302, 503, 412] {
            let count = Arc::new(AtomicUsize::new(0));
            let calls = count.clone();
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = format!("http://{}", listener.local_addr().unwrap());
            let location = format!("{endpoint}/again");
            let app = axum::Router::new().fallback(move || {
                let calls = calls.clone();
                let location = location.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    (
                        axum::http::StatusCode::from_u16(status).unwrap(),
                        [(axum::http::header::LOCATION, location)],
                    )
                }
            });
            let server = tokio::spawn(async move {
                axum::serve(listener, app).await.unwrap();
            });
            let a = Arc::new(
                Allowance::new(Counts {
                    reads: 5,
                    writes: 5,
                    put_bytes: 5,
                })
                .unwrap(),
            );
            let mut t = HttpS3Transport::new(
                &endpoint,
                "owned-records",
                "ap-northeast-2",
                rusty_s3::Credentials::new("local", "local-secret"),
            )
            .unwrap();
            t.test_allowance = Some(a.clone());
            if status == 412 {
                assert_eq!(
                    t.put_control("index/v2/test.json", b"{}", &WriteCondition::Absent)
                        .await
                        .unwrap(),
                    412
                );
                assert_eq!(a.remaining().unwrap().writes, 4);
                assert_eq!(a.remaining().unwrap().put_bytes, 3);
            } else {
                assert!(
                    matches!(t.get("raw/v2/test",1024).await, Err(crate::storage::Error::Status(s)) if s == status)
                );
                assert_eq!(a.remaining().unwrap().reads, 4);
            }
            assert_eq!(count.load(Ordering::SeqCst), 1);
            server.abort();
        }
    }

    async fn exercise(allowance: Option<Arc<Allowance>>) -> usize {
        let calls = Arc::new(AtomicUsize::new(0));
        let count = calls.clone();
        let app = axum::Router::new().fallback(move || {
            let count = count.clone();
            async move {
                count.fetch_add(1, Ordering::SeqCst);
                axum::http::StatusCode::NOT_FOUND
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let mut t = HttpS3Transport::new(
            &endpoint,
            "owned-records",
            "ap-northeast-2",
            rusty_s3::Credentials::new("local", "local-secret"),
        )
        .unwrap();
        t.test_allowance = allowance;
        let t = Arc::new(t);
        let raw = PreparedRecord {
            key: "raw/v2/test.json".into(),
            metadata: Default::default(),
            md5: "unused".into(),
            body: vec![1, 2, 3],
        };
        let _ = t.head(&raw.key).await;
        let _ = t.get(&raw.key, 1024).await;
        let _ = t.put(&raw).await;
        let _ = t.get_control("index/v2/test.json", 1024).await;
        let _ = t
            .put_control("index/v2/test.json", b"{}", &WriteCondition::Absent)
            .await;
        let _ = t.list_raw_document("raw/v2/", None, 1, 1024).await;
        let _ = t.get_demand("state/demand/grid/test.json").await;
        let _ = t
            .put_demand(
                "state/demand/grid/test.json",
                b"{}",
                &WriteCondition::Absent,
            )
            .await;
        let _ = t.list_demand("state/demand/grid/", None).await;
        let _ = t.list_index("index/v2/", None).await;
        let _ = t.list_summary("summary/v2/", None).await;
        let _ = t.get_summary("summary/v2/test.json").await;
        let _ = t.put_summary("summary/v2/test.json", b"{}").await;
        let _ = t.get_budget("budgets/v2/test.json").await;
        let _ = t
            .put_budget("budgets/v2/test.json", b"{}", &WriteCondition::Absent)
            .await;
        let address = S3AddressStore::new(t);
        let _ = address.get("Seoul").await;
        let p = AddressProjection {
            geo: GeoClient {
                address: Some("Seoul".into()),
                location: Some(Location {
                    lat: 37.0,
                    long: 127.0,
                }),
                ..Default::default()
            },
            updated_unix_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        };
        let _ = address.put("Seoul", &p).await;
        task.abort();
        calls.load(Ordering::SeqCst)
    }
    #[tokio::test]
    async fn default_reaches_all_physical_sends_and_list_callers() {
        assert_eq!(exercise(None).await, 17);
    }
    #[tokio::test]
    async fn exhausted_allowance_blocks_every_adapter_before_network() {
        let a = Arc::new(
            Allowance::new(Counts {
                reads: 0,
                writes: 0,
                put_bytes: 0,
            })
            .unwrap(),
        );
        assert_eq!(exercise(Some(a)).await, 0);
    }
    #[tokio::test]
    async fn errors_still_consume_read_write_and_put_byte_allowance() {
        let initial = Counts {
            reads: 20,
            writes: 20,
            put_bytes: 4096,
        };
        let a = Arc::new(Allowance::new(initial).unwrap());
        assert_eq!(exercise(Some(a.clone())).await, 17);
        let remaining = a.remaining().unwrap();
        assert_eq!(remaining.reads, 13);
        assert_eq!(remaining.writes, 10);
        assert!(remaining.put_bytes < initial.put_bytes - 11);
    }
}
