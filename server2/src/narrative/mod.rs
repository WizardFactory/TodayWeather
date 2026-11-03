//! Optional original KMA prose. HTTP reads stored originals; only the owned worker acquires.
pub mod provider;
pub mod store;

use crate::gateway::{BoxFuture, OrderedJson};
use serde::Serialize;
use serde_json::Value;
use std::{sync::Arc, time::Duration};
use tokio::time::Instant;

pub const DAY_MS: i64 = 86_400_000;
pub const OFFICES: [(u16, &str, &[&str]); 10] = [
    (108, "전국", &[]),
    (
        109,
        "서울·인천·경기도",
        &["서울특별시", "서울", "인천광역시", "인천", "경기도", "경기"],
    ),
    (
        159,
        "부산·울산·경상남도",
        &[
            "부산광역시",
            "부산",
            "울산광역시",
            "울산",
            "경상남도",
            "경남",
        ],
    ),
    (
        143,
        "대구·경상북도",
        &["대구광역시", "대구", "경상북도", "경북"],
    ),
    (
        156,
        "광주·전라남도",
        &[
            "광주광역시",
            "광주",
            "전라남도",
            "전남",
            "전남광주통합특별시",
        ],
    ),
    (
        146,
        "전북특별자치도",
        &["전라북도", "전북특별자치도", "전북자치도", "전북"],
    ),
    (
        133,
        "대전·세종·충청남도",
        &[
            "대전광역시",
            "대전",
            "세종특별자치시",
            "세종",
            "충청남도",
            "충남",
        ],
    ),
    (131, "충청북도", &["충청북도", "충북"]),
    (105, "강원특별자치도", &["강원도", "강원특별자치도", "강원"]),
    (184, "제주특별자치도", &["제주특별자치도", "제주도", "제주"]),
];
pub fn office(province: &str) -> Option<u16> {
    OFFICES
        .iter()
        .find(|(_, _, aliases)| {
            aliases.contains(&province.trim_matches(crate::world::js::is_js_space))
        })
        .map(|o| o.0)
}
pub fn announcement(tm: &str) -> Option<i64> {
    if tm.len() != 12 || !tm.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let part = |a, b| tm[a..b].parse::<i32>().ok();
    let year = part(0, 4)?;
    if year < 100 {
        return None;
    } // Date.UTC maps 0..99 to 1900..1999: legacy rejects them.
    let month = time::Month::try_from(part(4, 6)? as u8).ok()?;
    let date = time::Date::from_calendar_date(year, month, part(6, 8)? as u8).ok()?;
    let wall = date
        .with_hms(part(8, 10)? as u8, part(10, 12)? as u8, 0)
        .ok()?;
    Some((wall.assume_utc().unix_timestamp_nanos() / 1_000_000) as i64 - 9 * 3_600_000)
}
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Narrative {
    pub station_id: u16,
    pub region: String,
    pub announcement: String,
    pub expires_at: String,
    pub text: String,
    pub language: &'static str,
    pub source: &'static str,
    pub text_format: &'static str,
}
impl Narrative {
    pub fn fresh(&self, now: i64) -> bool {
        timestamp(&self.announcement).is_some_and(|at| now >= at && now - at < DAY_MS)
    }
}
fn timestamp(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.timestamp_millis())
}
/// Validate every row before selecting a fresh latest publication, as PR2805 does.
pub fn select(
    station: u16,
    rows: &[Value],
    now: i64,
) -> Result<Option<(String, Narrative)>, &'static str> {
    let (_, region, _) = OFFICES.iter().find(|o| o.0 == station).ok_or("office")?;
    if rows.is_empty() || rows.len() > 10 {
        return Err("items");
    }
    let mut best = None;
    for row in rows {
        let station_ok = row.get("stnId").is_some_and(|id| {
            id.as_f64() == Some(station as f64) || id.as_str() == Some(&station.to_string())
        });
        let tm = row
            .get("tmFc")
            .and_then(|v| match v {
                Value::String(s) => Some(s.clone()),
                Value::Number(n) => n.as_f64().map(crate::world::js::num_string),
                _ => None,
            })
            .ok_or("publication")?;
        let at = announcement(&tm).ok_or("publication")?;
        let text = row
            .get("wfSv1")
            .and_then(Value::as_str)
            .filter(|t| !t.trim_matches(crate::world::js::is_js_space).is_empty())
            .ok_or("text")?;
        if !station_ok {
            return Err("office");
        }
        if now < at || now - at >= DAY_MS {
            continue;
        }
        if best
            .as_ref()
            .is_some_and(|(old, _): &(String, Narrative)| old >= &tm)
        {
            continue;
        }
        let iso = |at| crate::world::js::iso(at as f64).ok_or("timestamp");
        best = Some((
            tm,
            Narrative {
                station_id: station,
                region: (*region).into(),
                announcement: iso(at)?,
                expires_at: iso(at + DAY_MS)?,
                text: text.replace("\r\n", "\n").replace('\r', "\n"),
                language: "ko",
                source: "KMA",
                text_format: "plain",
            },
        ));
    }
    Ok(best)
}
pub trait Read: Send + Sync {
    fn read(&self, station: u16, deadline: Instant) -> BoxFuture<'_, Option<Narrative>>;
}
pub trait Acquire: Send + Sync {
    fn refresh(&self) -> BoxFuture<'_, ()>;
}
pub async fn attach(
    body: &mut OrderedJson,
    station: Option<u16>,
    reader: Option<&Arc<dyn Read>>,
    deadline: Instant,
) {
    attach_with_clock(body, station, reader, deadline, &now_ms).await;
}
pub(crate) async fn attach_with_clock(
    body: &mut OrderedJson,
    station: Option<u16>,
    reader: Option<&Arc<dyn Read>>,
    deadline: Instant,
    clock: &(dyn Fn() -> i64 + Send + Sync),
) {
    let OrderedJson::Object(fields) = body else {
        return;
    };
    let key = "forecastNarrative".encode_utf16().collect::<Vec<_>>();
    fields.retain(|(k, _)| k != &key);
    let (Some(station), Some(reader)) = (station, reader) else {
        return;
    };
    let deadline = deadline.min(Instant::now() + Duration::from_secs(2));
    if let Ok(Some(n)) = tokio::time::timeout_at(deadline, reader.read(station, deadline)).await
        && n.station_id == station
        && n.fresh(clock())
        && let Ok(n) = OrderedJson::from_serde(&n)
    {
        fields.push((key, n));
    }
}
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis().min(i64::MAX as u128) as i64)
}
/// Bounded borrowed decode: unknown weather fields are skipped, not copied.
pub fn cache_age(body: &[u8], max_age: Option<u32>, now: i64) -> Option<u32> {
    #[derive(serde::Deserialize)]
    struct Body<'a> {
        #[serde(borrow, rename = "forecastNarrative")]
        narrative: Option<Expiry<'a>>,
    }
    #[derive(serde::Deserialize)]
    struct Expiry<'a> {
        #[serde(borrow, rename = "expiresAt")]
        expires_at: &'a str,
    }
    let expires = serde_json::from_slice::<Body<'_>>(body)
        .ok()?
        .narrative
        .and_then(|n| timestamp(n.expires_at))?;
    Some(
        max_age
            .unwrap_or(300)
            .min(300)
            .min((expires.saturating_sub(now).max(0) / 1000) as u32),
    )
}
/// Caller owns this handle. Cancellation never detaches a provider cycle.
pub struct Worker(tokio::task::JoinHandle<()>);
impl Worker {
    pub async fn stop(mut self) {
        self.0.abort();
        let _ = (&mut self.0).await;
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        self.0.abort();
    }
}
pub fn worker(acquire: Arc<dyn Acquire>, period: Duration) -> Worker {
    Worker(tokio::spawn(async move {
        let mut ticks = tokio::time::interval_at(Instant::now() + period, period);
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticks.tick().await;
            crate::observability::root_work(
                crate::observability::Component::Domestic,
                crate::observability::Stage::Worker,
                acquire.refresh(),
            )
            .await;
        }
    }))
}

#[cfg(test)]
mod attachment_tests {
    use super::*;
    use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};

    struct Stored(Narrative);
    impl Read for Stored {
        fn read(&self, _: u16, _: Instant) -> BoxFuture<'_, Option<Narrative>> {
            Box::pin(async { Some(self.0.clone()) })
        }
    }
    fn prose(at: i64) -> Narrative {
        Narrative {
            station_id: 108,
            region: "전국".into(),
            announcement: crate::world::js::iso(at as f64).unwrap(),
            expires_at: crate::world::js::iso((at + DAY_MS) as f64).unwrap(),
            text: "literal <b>rain</b>".into(),
            language: "ko",
            source: "KMA",
            text_format: "plain",
        }
    }
    fn body() -> OrderedJson {
        OrderedJson::parse(br#"{"weather":[],"forecastNarrative":"stale child"}"#).unwrap()
    }

    #[tokio::test]
    async fn fixed_attachment_checks_freshness_and_station_at_its_own_clock() {
        let at = announcement("202610160900").unwrap();
        let reader: Arc<dyn Read> = Arc::new(Stored(prose(at)));
        for (now, station, present) in [
            (at - 1, Some(108), false),
            (at, Some(108), true),
            (at + DAY_MS - 1, Some(108), true),
            (at + DAY_MS, Some(108), false),
            (at, Some(109), false),
            (at, None, false),
        ] {
            let mut body = body();
            attach_with_clock(
                &mut body,
                station,
                Some(&reader),
                Instant::now() + Duration::from_secs(5),
                &move || now,
            )
            .await;
            assert_eq!(
                body.get("forecastNarrative").is_some(),
                present,
                "{now} {station:?}"
            );
            assert_eq!(body.get("weather"), Some(&OrderedJson::Array(vec![])));
        }
        let mut body = body();
        attach_with_clock(&mut body, Some(108), None, Instant::now(), &move || at).await;
        assert!(body.get("forecastNarrative").is_none());
    }

    #[tokio::test]
    async fn attachment_rechecks_time_after_a_pending_read_expires() {
        struct Held {
            value: Narrative,
            started: tokio::sync::Notify,
            release: tokio::sync::Notify,
        }
        impl Read for Held {
            fn read(&self, _: u16, _: Instant) -> BoxFuture<'_, Option<Narrative>> {
                Box::pin(async {
                    self.started.notify_one();
                    self.release.notified().await;
                    Some(self.value.clone())
                })
            }
        }
        let at = announcement("202610160900").unwrap();
        let now = AtomicI64::new(at + DAY_MS - 1);
        let calls = AtomicUsize::new(0);
        let clock = || {
            calls.fetch_add(1, Ordering::SeqCst);
            now.load(Ordering::SeqCst)
        };
        let held = Arc::new(Held {
            value: prose(at),
            started: tokio::sync::Notify::new(),
            release: tokio::sync::Notify::new(),
        });
        let reader: Arc<dyn Read> = held.clone();
        let mut body = body();
        tokio::join!(
            attach_with_clock(
                &mut body,
                Some(108),
                Some(&reader),
                Instant::now() + Duration::from_secs(5),
                &clock
            ),
            async {
                held.started.notified().await;
                assert_eq!(
                    calls.load(Ordering::SeqCst),
                    0,
                    "clock sampled before read completed"
                );
                now.store(at + DAY_MS, Ordering::SeqCst);
                held.release.notify_one();
            }
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(body.get("forecastNarrative").is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn attachment_timeout_omits_prose_without_sampling_freshness() {
        struct Pending;
        impl Read for Pending {
            fn read(&self, _: u16, _: Instant) -> BoxFuture<'_, Option<Narrative>> {
                Box::pin(std::future::pending())
            }
        }
        let reader: Arc<dyn Read> = Arc::new(Pending);
        let mut body = body();
        let clock = || panic!("timeout must not sample freshness");
        attach_with_clock(
            &mut body,
            Some(108),
            Some(&reader),
            Instant::now() + Duration::from_secs(10),
            &clock,
        )
        .await;
        assert!(body.get("forecastNarrative").is_none());
    }

    #[tokio::test]
    async fn public_attachment_keeps_the_current_system_clock_default() {
        for (at, present) in [(now_ms() - 60_000, true), (0, false)] {
            let reader: Arc<dyn Read> = Arc::new(Stored(prose(at)));
            let mut body = body();
            attach(
                &mut body,
                Some(108),
                Some(&reader),
                Instant::now() + Duration::from_secs(5),
            )
            .await;
            assert_eq!(body.get("forecastNarrative").is_some(), present);
        }
    }
}
