//! The scheduled alarm worker (`ControllerPush.start` / `sendPush` / `sendNotification`).
//! Each UTC minute: remove duplicate registrations, select `pushTime === seconds-of-day` records
//! (`enable !== false`), keep those due on the client's weekday, claim the minute in the
//! ledger, deliver with at most six in flight, then delete records unused for 60 days and stamp
//! records without `updatedAt`. A failed or unknown send is recorded and never retried; a later
//! minute is a separate delivery.
use super::fcm::{Fcm, Product, SendOutcome};
use super::ledger::{Claim, Ledger, Written};
use super::weather::{self, Fetch, Servers, WeatherFailure};
use crate::budget::Clock;
use crate::push::{
    js::{self, to_string},
    service::{InternalOp, PushService, StaleSelection},
    store::{Coll, Oid, oid_hex},
};
use crate::storage::CatalogTransport;
use crate::world::js::{Obj, Val};
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use tokio::sync::Semaphore;

/// `async.mapLimit(pushList, 6, ...)`.
pub const CONCURRENCY: usize = 6;
const DAY_MS: i64 = 86_400_000;

/// The outcome class of one delivery (the ledger and diagnostics vocabulary).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Delivery {
    Accepted,
    /// FCM: token not registered; `disabled` tells whether disabling the token's alarms was
    /// committed.
    Unregistered {
        status: u16,
        disabled: bool,
    },
    Rejected {
        status: u16,
        code: String,
    },
    /// May have been delivered; not retried.
    Unknown {
        reason: &'static str,
    },
    /// Nothing was sent.
    Failed {
        class: &'static str,
    },
}
impl Delivery {
    pub fn outcome(&self) -> &'static str {
        match self {
            Delivery::Accepted => "accepted",
            Delivery::Unregistered { .. } => "unregistered",
            Delivery::Rejected { .. } => "rejected",
            Delivery::Unknown { .. } => "unknown",
            Delivery::Failed { .. } => "failed",
        }
    }
    pub fn class(&self) -> String {
        match self {
            Delivery::Accepted => "fcm".into(),
            Delivery::Unregistered { disabled: true, .. } => {
                "messaging/registration-token-not-registered".into()
            }
            Delivery::Unregistered {
                disabled: false, ..
            } => "messaging/registration-token-not-registered;disable-failed".into(),
            Delivery::Rejected { code, .. } => code.clone(),
            Delivery::Unknown { reason } => format!("fcm-{reason}"),
            Delivery::Failed { class } => (*class).into(),
        }
    }
    pub(crate) fn status(&self) -> Option<u16> {
        match self {
            Delivery::Unregistered { status, .. } | Delivery::Rejected { status, .. } => {
                Some(*status)
            }
            _ => None,
        }
    }
}

/// One sanitized diagnostic event: record `_id`, minute, outcome and class; never a token,
/// coordinate, name or message text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Event {
    pub kind: &'static str,
    pub minute: String,
    pub id: String,
    pub outcome: &'static str,
    pub class: String,
    pub status: Option<u16>,
}
pub trait Diagnostics: Send + Sync {
    fn delivery(&self, event: &Event);
    fn minute(&self, minute: &str, note: &'static str);
}
/// Standard error lines (the legacy worker logged through `log.error`).
pub struct StderrDiagnostics;
impl Diagnostics for StderrDiagnostics {
    fn delivery(&self, e: &Event) {
        if e.outcome != "accepted" {
            eprintln!(
                "push {} minute={} id={} outcome={} class={} status={}",
                e.kind,
                e.minute,
                e.id,
                e.outcome,
                e.class,
                e.status.map_or_else(|| "-".into(), |s| s.to_string())
            );
        }
    }
    fn minute(&self, minute: &str, note: &'static str) {
        eprintln!("push minute={minute} {note}");
    }
}

#[derive(Debug, Default)]
pub struct Counters {
    pub minutes: AtomicU64,
    pub minutes_skipped: AtomicU64,
    pub results_unrecorded: AtomicU64,
    pub selected: AtomicU64,
    pub accepted: AtomicU64,
    pub unregistered: AtomicU64,
    pub rejected: AtomicU64,
    pub unknown: AtomicU64,
    pub failed: AtomicU64,
    pub removed_old: AtomicU64,
    pub stamped: AtomicU64,
}

/// What one minute did (tests and operators).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MinuteReport {
    pub claimed: bool,
    pub deliveries: Vec<(String, String, String)>,
}

pub struct AlarmWorker<T> {
    push: Arc<PushService>,
    ledger: Ledger<T>,
    fetch: Arc<dyn Fetch>,
    fcm: Arc<Fcm>,
    servers: Servers,
    clock: Arc<dyn Clock>,
    diagnostics: Arc<dyn Diagnostics>,
    pub counters: Arc<Counters>,
}

/// `kmaTimeLib.toLocalTime(offset, now).getDay()` in the UTC process zone.
fn local_weekday(now_ms: i64, offset: &Val) -> i64 {
    let minutes = js::number(offset);
    if minutes.is_nan() {
        return -1;
    }
    let local = now_ms as f64 + minutes * 60_000.;
    ((local / DAY_MS as f64).floor() as i64 + 4).rem_euclid(7)
}

/// `_filterByDayOfWeek`.
fn due_today(info: &Obj, now_ms: i64) -> bool {
    let days = info.get("dayOfWeek");
    if days.truthy()
        && js::greater(
            &js::prop(days, "length").unwrap_or(Val::Undef),
            &Val::Num(0.),
        )
    {
        if !info.has("timezoneOffset") {
            return false;
        }
        let day = local_weekday(now_ms, info.get("timezoneOffset"));
        if day < 0 {
            return false;
        }
        return js::prop(days, &day.to_string()).is_ok_and(|v| v.truthy());
    }
    true
}

/// The FCM request body: `{"message": {notification: {title, body}, data: {cityIndex}, token}}`.
pub fn fcm_body(message: &super::text::Message, info: &Obj) -> Vec<u8> {
    let mut notification = Obj::new();
    notification.set("title", message.title.clone());
    notification.set("body", message.text.clone());
    let mut data = Obj::new();
    data.set("cityIndex", to_string(info.get("cityIndex")));
    let mut m = Obj::new();
    m.set("notification", Val::Obj(notification));
    m.set("data", Val::Obj(data));
    m.set("token", info.get("fcmToken").clone());
    let mut root = Obj::new();
    root.set("message", Val::Obj(m));
    Val::Obj(root).to_json()
}

impl<T: CatalogTransport + Send + Sync + 'static> AlarmWorker<T> {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        push: Arc<PushService>,
        transport: Arc<T>,
        fetch: Arc<dyn Fetch>,
        fcm: Arc<Fcm>,
        servers: Servers,
        clock: Arc<dyn Clock>,
        diagnostics: Arc<dyn Diagnostics>,
    ) -> Self {
        Self {
            push,
            ledger: Ledger::new(transport, std::time::Duration::from_secs(4)),
            fetch,
            fcm,
            servers,
            clock,
            diagnostics,
            counters: Arc::new(Counters::default()),
        }
    }

    /// `sendNotification`: weather, text, provider (one delivery, never retried).
    pub async fn deliver(&self, info: &mut Obj, now_ms: i64) -> Delivery {
        self.deliver_selected(info, now_ms, &[]).await
    }

    /// [`Self::deliver`] within a minute whose stale cleanups are `stale`: an unregistered
    /// token's disable removes those of the same token in the same journal entry.
    async fn deliver_selected(
        &self,
        info: &mut Obj,
        now_ms: i64,
        stale: &[StaleSelection],
    ) -> Delivery {
        let message = match weather::daily_summary(info, &self.servers, &*self.fetch).await {
            Ok(m) => m,
            Err(WeatherFailure::Request(what, _)) => {
                return Delivery::Failed {
                    class: match what {
                        "geocode" => "geocode-request",
                        _ => "weather-request",
                    },
                };
            }
            Err(WeatherFailure::Build(_)) => return Delivery::Failed { class: "build" },
        };
        let token = info.get("fcmToken").clone();
        if token.truthy() {
            if !matches!(token, Val::Str(_)) {
                return Delivery::Failed {
                    class: "invalid-token",
                };
            }
            let body = fcm_body(&message, info);
            // The OAuth assertion and token expiry use the time of this send, not the minute's
            // start: with six in flight a long minute can outlast a cached token.
            let send_ms = self.clock.now_ms().unwrap_or(now_ms);
            return match self
                .fcm
                .send(Product::of(info.get("package")), body, send_ms)
                .await
            {
                SendOutcome::Accepted => Delivery::Accepted,
                SendOutcome::Unregistered { status } => {
                    // Legacy disabled the token's alarms without waiting; server2 waits until the
                    // disable is durable (or failed) so the outcome says which.
                    let disabled = self
                        .push
                        .internal(InternalOp::DisableAlarmsByFcm {
                            token: to_string(&token),
                            spare: stale
                                .iter()
                                .filter(|s| s.selected.get("fcmToken") == &token)
                                .cloned()
                                .collect(),
                        })
                        .await;
                    Delivery::Unregistered { status, disabled }
                }
                SendOutcome::Rejected { status, code } => Delivery::Rejected { status, code },
                SendOutcome::Unknown { reason } => Delivery::Unknown { reason },
                SendOutcome::NotSent { reason } => Delivery::Failed {
                    class: match reason {
                        "credentials" => "fcm-credentials",
                        "oauth" => "fcm-oauth",
                        _ => "fcm-connect",
                    },
                },
            };
        }
        let kind = info.get("type");
        if js::loose_eq(kind, &Val::Str("ios".into())) {
            Delivery::Failed {
                class: "ios-without-fcm-token",
            }
        } else if js::loose_eq(kind, &Val::Str("android".into())) {
            if info.get("registrationId").truthy() {
                // node-gcm used the legacy GCM/FCM HTTP API that Google shut down in 2024.
                Delivery::Failed {
                    class: "gcm-retired",
                }
            } else {
                Delivery::Failed {
                    class: "gcm-without-registration-id",
                }
            }
        } else {
            Delivery::Failed {
                class: "unknown-type",
            }
        }
    }

    /// `sendPush(time)` for the UTC minute containing `now_ms`.
    pub async fn run_minute(&self, now_ms: i64) -> MinuteReport {
        let minute_ms = now_ms - now_ms.rem_euclid(60_000);
        let time = ((minute_ms.rem_euclid(DAY_MS)) / 1000) as f64;
        let minute = crate::world::js::iso(minute_ms as f64).unwrap_or_default();
        self.counters.minutes.fetch_add(1, Ordering::Relaxed);
        if !self.push.ready() {
            // The registrations are not restored yet: the due set is unknown, so the minute is
            // neither claimed nor sent (claiming an empty set would drop it for every process).
            self.counters
                .minutes_skipped
                .fetch_add(1, Ordering::Relaxed);
            self.diagnostics
                .minute(&minute, "push state not ready; nothing sent");
            return MinuteReport::default();
        }
        self.push.internal(InternalOp::RemoveDuplicateAlarms).await;
        let due: Vec<(u64, Oid, Obj)> = {
            let state = self.push.state();
            let state = state.read().unwrap_or_else(|e| e.into_inner());
            state
                .coll(Coll::Alarm)
                .due(time)
                .into_iter()
                .map(|(n, r)| (n, r.oid, r.doc))
                .filter(|(_, _, doc)| due_today(doc, now_ms))
                .collect()
        };
        self.counters
            .selected
            .fetch_add(due.len() as u64, Ordering::Relaxed);
        if due.is_empty() {
            // Nothing to send or clean up: no ledger objects for an empty minute.
            return MinuteReport::default();
        }
        let ids: Vec<String> = due.iter().map(|(_, oid, _)| oid_hex(oid)).collect();
        match self.ledger.claim("alarm", minute_ms, now_ms, &ids).await {
            Claim::Owned => (),
            Claim::Taken => {
                self.counters
                    .minutes_skipped
                    .fetch_add(1, Ordering::Relaxed);
                self.diagnostics
                    .minute(&minute, "already claimed; nothing sent");
                return MinuteReport::default();
            }
            Claim::Unavailable => {
                self.counters
                    .minutes_skipped
                    .fetch_add(1, Ordering::Relaxed);
                self.diagnostics
                    .minute(&minute, "ledger unavailable; nothing sent");
                return MinuteReport::default();
            }
        }
        // `_removeOldList` decides on the records as selected: stale ones (not updated for 60
        // days) are removed after the sends, the others without `updatedAt` are stamped.
        let cutoff = now_ms - 60 * DAY_MS;
        let selections: Vec<(u64, Oid, Obj, Option<StaleSelection>)> =
            due.into_iter()
                .map(|(n, oid, info)| {
                    let stale = match info.get("updatedAt") {
                        Val::Date(ms) if (*ms as i64) < cutoff => super::ops::remove_filter(&info)
                            .map(|filter| StaleSelection {
                                n,
                                oid,
                                selected: info.clone(),
                                cutoff_ms: cutoff,
                                filter,
                            }),
                        _ => None,
                    };
                    (n, oid, info, stale)
                })
                .collect();
        let all_stale: Arc<Vec<StaleSelection>> = Arc::new(
            selections
                .iter()
                .filter_map(|(_, _, _, s)| s.clone())
                .collect(),
        );
        let gate = Arc::new(Semaphore::new(CONCURRENCY));
        let mut tasks = Vec::with_capacity(selections.len());
        for (n, oid, info, stale) in selections {
            let gate = gate.clone();
            let all_stale = all_stale.clone();
            tasks.push(async move {
                let _permit = gate.acquire_owned().await.expect("open gate");
                let mut info = info;
                let delivery = self.deliver_selected(&mut info, now_ms, &all_stale).await;
                (n, oid, stale, info, delivery)
            });
        }
        let results = futures_join(tasks).await;
        let mut report = MinuteReport {
            claimed: true,
            deliveries: Vec::new(),
        };
        let mut rows = Vec::new();
        for (_, oid, _, _, d) in &results {
            let id = &oid_hex(oid);
            let counter = match d {
                Delivery::Accepted => &self.counters.accepted,
                Delivery::Unregistered { .. } => &self.counters.unregistered,
                Delivery::Rejected { .. } => &self.counters.rejected,
                Delivery::Unknown { .. } => &self.counters.unknown,
                Delivery::Failed { .. } => &self.counters.failed,
            };
            counter.fetch_add(1, Ordering::Relaxed);
            let event = Event {
                kind: "alarm",
                minute: minute.clone(),
                id: id.clone(),
                outcome: d.outcome(),
                class: d.class(),
                status: d.status(),
            };
            self.diagnostics.delivery(&event);
            rows.push(serde_json::json!({"_id": id, "outcome": event.outcome, "class": event.class, "status": event.status}));
            report
                .deliveries
                .push((id.clone(), event.outcome.into(), event.class));
        }
        let recorded = self
            .ledger
            .result(
                "alarm",
                minute_ms,
                &serde_json::json!({"schema": 1, "kind": "alarm", "minute": minute, "deliveries": rows}),
            )
            .await;
        // Either way the claim stays and nothing is resent; the outcomes are in this process's
        // diagnostics and counters.
        let note = match recorded {
            Written::Recorded => None,
            Written::Refused => Some("result not recorded; claim kept, nothing resent"),
            Written::Unknown => Some("result write outcome unknown; claim kept, nothing resent"),
        };
        if let Some(note) = note {
            self.counters
                .results_unrecorded
                .fetch_add(1, Ordering::Relaxed);
            self.diagnostics.minute(&minute, note);
        }
        // `_removeOldList`. Each operation re-checks the records in the writer, so a change made
        // since selection (a user update, a removal) is never undone.
        for (n, oid, stale, info, _) in results {
            if let Some(stale) = stale {
                if self.push.internal(InternalOp::RemoveAlarms(stale)).await {
                    self.counters.removed_old.fetch_add(1, Ordering::Relaxed);
                }
            } else if info.get("updatedAt").is_nullish()
                && self
                    .push
                    .internal(InternalOp::StampAlarm { n, oid, info })
                    .await
            {
                self.counters.stamped.fetch_add(1, Ordering::Relaxed);
            }
        }
        report
    }

    /// Run minutes forever, one at each UTC minute boundary (`setInterval(60 s)`); minutes may
    /// overlap as legacy batches did. A minute missed while the process was down is not caught
    /// up.
    pub async fn run(self: Arc<Self>) {
        loop {
            let Ok(now) = self.clock.now_ms() else {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue;
            };
            let next = now - now.rem_euclid(60_000) + 60_000;
            tokio::time::sleep(std::time::Duration::from_millis((next - now) as u64)).await;
            let worker = self.clone();
            tokio::spawn(async move {
                worker.run_minute(next).await;
            });
        }
    }
}

/// Await every future, keeping their order (the gate bounds concurrency).
pub(crate) async fn futures_join<F: std::future::Future>(tasks: Vec<F>) -> Vec<F::Output> {
    let mut pinned: Vec<std::pin::Pin<Box<F>>> = tasks.into_iter().map(Box::pin).collect();
    let mut out: Vec<Option<F::Output>> = (0..pinned.len()).map(|_| None).collect();
    std::future::poll_fn(|cx| {
        let mut pending = false;
        for (i, f) in pinned.iter_mut().enumerate() {
            if out[i].is_none() {
                match f.as_mut().poll(cx) {
                    std::task::Poll::Ready(v) => out[i] = Some(v),
                    std::task::Poll::Pending => pending = true,
                }
            }
        }
        if pending {
            std::task::Poll::Pending
        } else {
            std::task::Poll::Ready(())
        }
    })
    .await;
    out.into_iter().map(|v| v.expect("completed")).collect()
}
