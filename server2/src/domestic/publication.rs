//! KST publication identities and legacy query-time helpers. Pure: callers pass UTC ms.
//! Ported from controllerManager.js (getShortQueryTime, getShortestQueryTime,
//! getCurrentQueryTime, getMid*), PastConditionGather.makePubDateList,
//! lifeIndexKmaRequester.getUvTimeSlotsV5/taskPollenV3 and TownRss.lastestPubDate at ca8735cf.
use crate::storage::Period;
use time::{Date, Duration, Month, OffsetDateTime, PrimitiveDateTime, Time, UtcOffset};

/// A KST provider publication (`YYYYMMDD`, `HHMM`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Publication {
    date: u32,
    time: u16,
}
impl Publication {
    pub fn new(date: u32, time: u16) -> Option<Self> {
        if time / 100 > 23 || time % 100 > 59 || !(19700101..=99991231).contains(&date) {
            return None;
        }
        let month = Month::try_from(((date / 100) % 100) as u8).ok()?;
        Date::from_calendar_date((date / 10000) as i32, month, (date % 100) as u8).ok()?;
        Some(Self { date, time })
    }
    pub fn date(self) -> u32 {
        self.date
    }
    pub fn time(self) -> u16 {
        self.time
    }
    pub fn hour(self) -> u16 {
        self.time / 100
    }
    pub fn minute(self) -> u16 {
        self.time % 100
    }
    pub fn base_date(self) -> String {
        format!("{:08}", self.date)
    }
    pub fn base_time(self) -> String {
        format!("{:04}", self.time)
    }
    /// `YYYYMMDDHHMM`.
    pub fn compact(self) -> String {
        format!("{:08}{:04}", self.date, self.time)
    }
    /// Deterministic catalog partition token `YYYYMMDD-HHMM`.
    pub fn partition(self) -> String {
        format!("{:08}-{:04}", self.date, self.time)
    }
    pub fn period(self) -> Period {
        Period {
            local_date: self.date,
            slot: self.base_time(),
        }
    }
    /// The same hour at minute zero.
    pub fn hour_start(self) -> Self {
        Self {
            date: self.date,
            time: self.time - self.time % 100,
        }
    }
    /// Exactly twelve ASCII digits `YYYYMMDDHHMM`.
    pub fn parse_compact(s: &str) -> Option<Self> {
        if s.len() != 12 || !s.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        Self::new(s[..8].parse().ok()?, s[8..].parse().ok()?)
    }
    /// KMA page form `YYYY.M[M].D[D].H[H]:MM` (legacy city regex).
    pub fn parse_dotted(s: &str) -> Option<Self> {
        let (day, clock) = s.rsplit_once('.')?;
        let mut parts = day.split('.');
        let (y, m, d) = (parts.next()?, parts.next()?, parts.next()?);
        let (h, mi) = clock.split_once(':')?;
        let digits = |x: &str, lo: usize, hi: usize| {
            (lo..=hi).contains(&x.len()) && x.bytes().all(|b| b.is_ascii_digit())
        };
        if parts.next().is_some()
            || !digits(y, 4, 4)
            || !digits(m, 1, 2)
            || !digits(d, 1, 2)
            || !digits(h, 1, 2)
            || !digits(mi, 2, 2)
        {
            return None;
        }
        let date = y.parse::<u32>().ok()? * 10000
            + m.parse::<u32>().ok()? * 100
            + d.parse::<u32>().ok()?;
        Self::new(date, h.parse::<u16>().ok()? * 100 + mi.parse::<u16>().ok()?)
    }
    fn datetime(self) -> Option<PrimitiveDateTime> {
        let month = Month::try_from(((self.date / 100) % 100) as u8).ok()?;
        let date =
            Date::from_calendar_date((self.date / 10000) as i32, month, (self.date % 100) as u8)
                .ok()?;
        let time = Time::from_hms(self.hour() as u8, self.minute() as u8, 0).ok()?;
        Some(PrimitiveDateTime::new(date, time))
    }
    fn from_datetime(t: PrimitiveDateTime) -> Option<Self> {
        let date = t.year() as u32 * 10000 + u8::from(t.month()) as u32 * 100 + t.day() as u32;
        Self::new(date, t.hour() as u16 * 100 + t.minute() as u16)
    }
    /// Calendar-correct hour offset.
    pub fn add_hours(self, hours: i64) -> Option<Self> {
        Self::from_datetime(self.datetime()?.checked_add(Duration::hours(hours))?)
    }
}

fn kst(now_ms: i64) -> Option<Publication> {
    if now_ms < 0 {
        return None;
    }
    let utc = OffsetDateTime::from_unix_timestamp_nanos(now_ms as i128 * 1_000_000).ok()?;
    let local = utc.to_offset(UtcOffset::from_hms(9, 0, 0).ok()?);
    Publication::from_datetime(PrimitiveDateTime::new(local.date(), local.time()))
}
fn at(p: Publication, time: u16) -> Option<Publication> {
    Publication::new(p.date, time)
}

/// getVilageFcst: 02,05,...,23 available from HH10; before 02:10 the previous day's 23:00.
pub fn short_base(now_ms: i64) -> Option<Publication> {
    let now = kst(now_ms)?;
    if now.time < 210 {
        return at(now.add_hours(-24)?, 2300);
    }
    let base = (200u16..=2300)
        .step_by(300)
        .filter(|base| now.time >= *base + 10)
        .max()?;
    at(now, base)
}
/// getUltraSrtFcst: HH30, the previous hour before minute 45.
pub fn ultra_short_base(now_ms: i64) -> Option<Publication> {
    let now = kst(now_ms)?;
    let hour = if now.minute() < 45 {
        now.add_hours(-1)?
    } else {
        now
    };
    at(hour, hour.hour() * 100 + 30)
}
/// getUltraSrtNcst: HH00, the previous hour before minute 40.
pub fn current_base(now_ms: i64) -> Option<Publication> {
    let now = kst(now_ms)?;
    let hour = if now.minute() < 40 {
        now.add_hours(-1)?
    } else {
        now
    };
    Some(hour.hour_start())
}
/// MidFcstInfoService tmFc: before 08 the previous day's 1800, before 20 0600, else 1800.
pub fn mid_tm_fc(now_ms: i64) -> Option<Publication> {
    let now = kst(now_ms)?;
    match now.hour() {
        0..=7 => at(now.add_hours(-24)?, 1800),
        8..=19 => at(now, 600),
        _ => at(now, 1800),
    }
}
/// 23 hourly getUltraSrtNcst backfill slots, newest first. UTC minute equals KST minute.
pub fn past_current_bases(now_ms: i64) -> Option<Vec<Publication>> {
    let now = kst(now_ms)?;
    let start = if now.minute() > 40 {
        now
    } else {
        now.add_hours(-1)?
    }
    .hour_start();
    (0..23).map(|i| start.add_hours(-i)).collect()
}
/// getUVIdxV5 issuance candidates: the current three-hour KST slot and four earlier.
pub fn uv_slots(now_ms: i64) -> Option<Vec<Publication>> {
    let now = kst(now_ms)?;
    let base = at(now, now.hour() / 3 * 300)?;
    (0..5).map(|i| base.add_hours(-3 * i)).collect()
}
/// Pollen V3 query time: the current KST hour.
pub fn pollen_time(now_ms: i64) -> Option<Publication> {
    Some(kst(now_ms)?.hour_start())
}
/// AirKorea dust forecast announcement expected now (S13b, `kecoRequester._checkDataTime` at
/// ae21b6cc): before 05 the previous day's 23시, then 05, 11, 17 and 23시 of the KST day. The
/// `getMinuDustFrcstDspth` search date is the announcement's date.
pub fn dust_forecast_announcement(now_ms: i64) -> Option<Publication> {
    let now = kst(now_ms)?;
    match now.hour() {
        0..=4 => at(now.add_hours(-24)?, 2300),
        5..=10 => at(now, 500),
        11..=16 => at(now, 1100),
        17..=22 => at(now, 1700),
        _ => at(now, 2300),
    }
}
/// AWS hourly and city observation pages: the current KST hour.
pub fn observation_hour(now_ms: i64) -> Option<Publication> {
    Some(kst(now_ms)?.hour_start())
}
/// Latest grid RSS publication expected by the legacy collector.
pub fn rss_latest(now_ms: i64) -> Option<Publication> {
    let now = kst(now_ms)?;
    if now.hour() <= 2 {
        return at(now.add_hours(-24)?, 2300);
    }
    at(now, ((now.hour() / 3 - 1) * 3 + 2) * 100)
}
