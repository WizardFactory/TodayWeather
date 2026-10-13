//! Derived DsfForecast state for one cell: replay of raw fetches, legacy classification
//! (`_findDataFromDB`) and `_makeOutputFormat`. In memory only; never persisted.
use super::{
    js::{Obj, Val, iso},
    vc::{Converted, Record},
};
use std::{collections::BTreeMap, str::FromStr, sync::Arc};

const MINUTE: f64 = 60_000.;
const DAY_MS: f64 = 86_400_000.;
pub const STALE_MS: f64 = 6. * 3_600_000.;
const READ_WINDOW_MS: f64 = 4. * DAY_MS;

/// UTC offset in minutes of an IANA zone at `ms` (the legacy Intl rule), when known.
pub fn zone_offset(zone: &str, ms: f64) -> Option<f64> {
    use chrono::{Offset, TimeZone};
    let tz = chrono_tz::Tz::from_str_insensitive(zone)
        .or_else(|_| chrono_tz::Tz::from_str(zone))
        .ok()?;
    let secs = (ms / 1000.).floor();
    if !secs.is_finite() || secs.abs() > 8.64e12 {
        return None;
    }
    let utc = chrono::DateTime::from_timestamp(secs as i64, 0)?;
    let offset = tz.offset_from_utc_datetime(&utc.naive_utc()).fix();
    Some(super::js::round(f64::from(offset.local_minus_utc()) / 60.))
}
fn local_day(ms: f64, offset_min: f64) -> Option<String> {
    if !ms.is_finite() || !offset_min.is_finite() {
        return None;
    }
    iso(ms + offset_min * MINUTE).map(|s| s[..10].to_owned())
}
fn day_start(day: &str) -> f64 {
    super::vc::parse_iso_z(&format!("{day}T00:00:00Z"))
}
fn previous_day(day: &str) -> Option<String> {
    iso(day_start(day) - DAY_MS).map(|s| s[..10].to_owned())
}
fn offset_at(item: &Record, now: f64) -> f64 {
    if let Some(zone) = item.zone.str().filter(|z| !z.is_empty())
        && zone_offset(zone, item.date_ms) == Some(item.offset_min)
        && let Some(now_offset) = zone_offset(zone, now)
    {
        return now_offset;
    }
    item.offset_min
}
fn is_local_midnight(item: &Record) -> bool {
    super::js::parts(item.date_ms + item.offset_min * MINUTE)
        .is_some_and(|p| p.hour == 0 && p.minute == 0 && p.second == 0)
}
fn newer(item: &Record, than: Option<&Arc<Record>>) -> bool {
    than.is_none_or(|t| item.pub_ms >= t.pub_ms || !t.pub_ms.is_finite())
}
fn fetched_after_day_end(item: &Record, day: &str, now_offset: f64) -> bool {
    if !item.pub_ms.is_finite() {
        return false;
    }
    item.pub_ms >= day_start(day) - now_offset * MINUTE
}

/// Classification result (`ret` in `_findDataFromDB`) and later merged fetch output.
#[derive(Clone, Default)]
pub struct Found {
    pub two_days_ago: Option<Arc<Record>>,
    pub yesterday: Option<Arc<Record>>,
    pub today: Option<Arc<Record>>,
    pub current: Option<Arc<Record>>,
    pub stale: Option<Arc<Record>>,
}
impl Found {
    /// `_hasAll(output, noYesterday)`.
    pub fn has_all(&self, no_yesterday: bool) -> bool {
        ((self.two_days_ago.is_some() && self.yesterday.is_some()) || no_yesterday)
            && self.today.is_some()
            && self.current.is_some()
    }
    /// `_merge(output, found)`.
    pub fn merge(&mut self, other: &Found) {
        for (slot, value) in [
            (&mut self.two_days_ago, &other.two_days_ago),
            (&mut self.yesterday, &other.yesterday),
            (&mut self.today, &other.today),
            (&mut self.current, &other.current),
            (&mut self.stale, &other.stale),
        ] {
            if value.is_some() {
                slot.clone_from(value);
            }
        }
    }
    /// `_fallback`: serve a current (or <= 6 h stale) record when one exists.
    pub fn fallback(mut self) -> Option<Found> {
        if self.current.is_none() && self.stale.is_some() {
            self.current = self.stale.clone();
        }
        self.current.is_some().then_some(self)
    }
}

/// Upserted records by `dateObj` and the latest no-yesterday marker for one cell.
#[derive(Clone, Default)]
pub struct Db {
    records: BTreeMap<i64, Arc<Record>>,
    pub no_yesterday_until: Option<f64>,
}
impl Db {
    pub fn len(&self) -> usize {
        self.records.len()
    }
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }
    /// Apply one fetch in legacy save order; returns the saved records by kind.
    pub fn apply(&mut self, converted: Converted) -> Found {
        let mut found = Found::default();
        for (kind, record) in converted.records {
            let record = Arc::new(record);
            self.records.insert(record.date_ms as i64, record.clone());
            let slot = match kind {
                super::vc::Kind::TwoDaysAgo => &mut found.two_days_ago,
                super::vc::Kind::Yesterday => &mut found.yesterday,
                super::vc::Kind::Today => &mut found.today,
                super::vc::Kind::Current => &mut found.current,
            };
            *slot = Some(record);
        }
        if let Some(until) = converted.no_yesterday_until {
            self.no_yesterday_until = Some(until);
        }
        found
    }
    /// Drop records that can no longer affect a request at or after `now`.
    pub fn prune(&mut self, now: f64) {
        let newest = self.records.keys().next_back().copied();
        self.records.retain(|k, r| {
            let ms = *k as f64;
            ms >= now - READ_WINDOW_MS
                && (Some(*k) == newest
                    || is_local_midnight(r)
                    || ms >= now - STALE_MS - 15. * MINUTE)
        });
    }
    pub fn no_yesterday(&self, now: f64, found: &Found) -> bool {
        if found.yesterday.is_some() && found.two_days_ago.is_some() {
            return false;
        }
        self.no_yesterday_until.is_some_and(|until| until > now)
    }
    /// `_findDataFromDB(geo, now)`.
    pub fn classify(&self, now: f64) -> Found {
        let list: Vec<&Arc<Record>> = self
            .records
            .range((now - READ_WINDOW_MS).ceil() as i64..)
            .map(|(_, r)| r)
            .collect();
        let mut ret = Found::default();
        let Some(last) = list.last() else {
            return ret;
        };
        let now_offset = offset_at(last, now);
        let Some(today) = local_day(now, now_offset) else {
            return ret;
        };
        let (Some(yesterday), Some(two)) = (
            previous_day(&today),
            previous_day(&today).and_then(|y| previous_day(&y)),
        ) else {
            return ret;
        };
        for item in list {
            let Some(record_day) = local_day(item.date_ms, item.offset_min) else {
                continue;
            };
            let midnight = is_local_midnight(item);
            let age = now - item.date_ms;
            if midnight && record_day == two {
                if fetched_after_day_end(item, &yesterday, now_offset)
                    && newer(item, ret.two_days_ago.as_ref())
                {
                    ret.two_days_ago = Some(item.clone());
                }
            } else if midnight && record_day == yesterday {
                if fetched_after_day_end(item, &today, now_offset)
                    && newer(item, ret.yesterday.as_ref())
                {
                    ret.yesterday = Some(item.clone());
                }
            } else if midnight && record_day == today {
                if newer(item, ret.today.as_ref()) {
                    ret.today = Some(item.clone());
                }
            } else if (0. ..=15. * MINUTE).contains(&age)
                && local_day(item.date_ms, now_offset).as_deref() == Some(today.as_str())
            {
                ret.current = Some(item.clone());
            } else if (0. ..=STALE_MS).contains(&age) {
                ret.stale = Some(item.clone());
            }
        }
        ret
    }
}

/// `req.DSF` and `req.result.timezone` after `_makeOutputFormat`.
pub struct Dsf {
    pub timezone: Obj,
    pub data: Vec<Obj>,
    pub date_obj: f64,
    pub lat: f64,
    pub lon: f64,
    pub weather_ms: f64,
}
pub fn output(found: &Found, lat: f64, lon: f64) -> Option<Dsf> {
    let current = found.current.as_ref()?;
    let mut timezone = Obj::new();
    let mut data = Vec::new();
    let mut date_obj = f64::NAN;
    for item in [
        &found.two_days_ago,
        &found.yesterday,
        &found.today,
        &found.current,
    ]
    .into_iter()
    .flatten()
    {
        timezone.set("timezoneId", item.zone.clone());
        timezone.set("min", item.offset_min);
        timezone.set("ms", item.offset_min * MINUTE);
        date_obj = item.date_ms;
        let mut d = item.data.clone();
        if let Some(c) = d.get_mut("current").and_then(Val::obj_mut) {
            c.set("timeOffset", item.offset_min);
        }
        data.push(d);
    }
    super::js::js_sort(&mut data, |a, b| {
        let (x, y) = (
            a.get("current").get("date").to_number(),
            b.get("current").get("date").to_number(),
        );
        if x > y {
            1
        } else if x < y {
            -1
        } else {
            0
        }
    });
    Some(Dsf {
        timezone,
        data,
        date_obj,
        lat,
        lon,
        weather_ms: current.data.get("current").get("dateObj").to_number(),
    })
}
