use crate::storage::{Error, RawRecord};
use std::{collections::BTreeMap, sync::Arc};
use time::{Date, Month, OffsetDateTime, UtcOffset};

/// One record-period identity, every revision retained in deterministic full-hash order.
pub struct RevisionIndex {
    records: Vec<Arc<RawRecord>>,
}
impl RevisionIndex {
    pub fn new(mut records: Vec<Arc<RawRecord>>, maximum: usize) -> Result<Self, Error> {
        if maximum == 0 || maximum > 8192 || records.len() > maximum {
            return Err(Error::Capacity);
        }
        if let Some(first) = records.first() {
            let id = &first.envelope.identity;
            for r in &records {
                r.envelope.identity.validate()?;
                let x = &r.envelope.identity;
                if (
                    x.source.as_str(),
                    x.kind.as_str(),
                    x.key_sha256.as_str(),
                    &x.period,
                ) != (
                    id.source.as_str(),
                    id.kind.as_str(),
                    id.key_sha256.as_str(),
                    &id.period,
                ) {
                    return Err(Error::Invalid("revision namespace/period"));
                }
            }
        }
        records.sort_by(|a, b| {
            let a = &a.envelope.identity;
            let b = &b.envelope.identity;
            (a.fetched_at_ms, &a.raw_sha256).cmp(&(b.fetched_at_ms, &b.raw_sha256))
        });
        if records
            .windows(2)
            .any(|r| r[0].envelope.identity == r[1].envelope.identity)
        {
            return Err(Error::Invalid("duplicate revision"));
        }
        Ok(Self { records })
    }
    pub fn records(&self) -> &[Arc<RawRecord>] {
        &self.records
    }
    pub fn range(&self, start: u64, end: u64) -> Result<&[Arc<RawRecord>], Error> {
        if start > end {
            return Err(Error::Invalid("revision range"));
        }
        let lo = self
            .records
            .partition_point(|r| r.envelope.identity.fetched_at_ms < start);
        let hi = self
            .records
            .partition_point(|r| r.envelope.identity.fetched_at_ms < end);
        Ok(&self.records[lo..hi])
    }
}
fn date(ymd: u32) -> Result<Date, Error> {
    if !(1..=9999).contains(&(ymd / 10000)) {
        return Err(Error::Invalid("calendar year"));
    }
    Date::from_calendar_date(
        (ymd / 10000) as i32,
        Month::try_from(((ymd / 100) % 100) as u8).map_err(|_| Error::Invalid("month"))?,
        (ymd % 100) as u8,
    )
    .map_err(|_| Error::Invalid("date"))
}
fn ymd(d: Date) -> u32 {
    d.year() as u32 * 10000 + u32::from(d.month() as u8) * 100 + u32::from(d.day())
}
/// Fixed KST day slots: 01..23 followed by the next date's 00:00 (legacy previous-day rule).
pub struct DomesticDay<V> {
    date: Date,
    slots: [Option<Arc<V>>; 24],
}
impl<V> DomesticDay<V> {
    pub fn new(day: u32) -> Result<Self, Error> {
        Ok(Self {
            date: date(day)?,
            slots: std::array::from_fn(|_| None),
        })
    }
    pub fn attributed_day(actual_day: u32, hour: u8) -> Result<u32, Error> {
        if hour > 23 {
            return Err(Error::Invalid("hour"));
        }
        let d = date(actual_day)?;
        let attributed = if hour == 0 {
            d.previous_day().ok_or(Error::Invalid("previous day"))?
        } else {
            d
        };
        if attributed.year() < 1 {
            return Err(Error::Invalid("previous calendar year"));
        }
        Ok(ymd(attributed))
    }
    pub fn insert(&mut self, actual_day: u32, hour: u8, value: Arc<V>) -> Result<(), Error> {
        if Self::attributed_day(actual_day, hour)? != ymd(self.date) {
            return Err(Error::Invalid("slot day"));
        }
        self.slots[if hour == 0 { 23 } else { usize::from(hour - 1) }] = Some(value);
        Ok(())
    }
    pub fn get(&self, hour: u8) -> Result<Option<&Arc<V>>, Error> {
        if hour > 23 {
            return Err(Error::Invalid("hour"));
        }
        Ok(self.slots[if hour == 0 { 23 } else { usize::from(hour - 1) }].as_ref())
    }
}
pub struct WorldHour<V> {
    pub epoch: i64,
    pub local_day: u32,
    pub offset_seconds: i32,
    pub value: Arc<V>,
}
/// UTC order keeps both repeated fall-back hours. A local-day lookup uses explicit offsets.
pub struct WorldHours<V> {
    hours: Vec<WorldHour<V>>,
    days: BTreeMap<u32, Vec<usize>>,
}
impl<V> WorldHours<V> {
    pub fn new(mut hours: Vec<WorldHour<V>>, maximum: usize) -> Result<Self, Error> {
        if maximum == 0 || maximum > 2048 || hours.len() > maximum {
            return Err(Error::Capacity);
        }
        hours.sort_by_key(|h| h.epoch);
        let mut days: BTreeMap<u32, Vec<usize>> = BTreeMap::new();
        for (i, h) in hours.iter().enumerate() {
            if i > 0 && hours[i - 1].epoch == h.epoch {
                return Err(Error::Invalid("duplicate world instant"));
            }
            if !(-43200..=50400).contains(&h.offset_seconds) {
                return Err(Error::Invalid("world offset"));
            }
            let d = OffsetDateTime::from_unix_timestamp(h.epoch)
                .map_err(|_| Error::Invalid("world epoch"))?
                .to_offset(
                    UtcOffset::from_whole_seconds(h.offset_seconds)
                        .map_err(|_| Error::Invalid("offset"))?,
                )
                .date();
            if date(h.local_day)? != d {
                return Err(Error::Invalid("world local date"));
            }
            let day = days.entry(h.local_day).or_default();
            day.push(i);
            if day.len() > 25 {
                return Err(Error::Invalid("world hourly day"));
            }
        }
        Ok(Self { hours, days })
    }
    pub fn range(&self, start: i64, end: i64) -> Result<&[WorldHour<V>], Error> {
        if start > end {
            return Err(Error::Invalid("world range"));
        }
        let lo = self.hours.partition_point(|h| h.epoch < start);
        let hi = self.hours.partition_point(|h| h.epoch < end);
        Ok(&self.hours[lo..hi])
    }
    pub fn day(&self, local_day: u32) -> Vec<&WorldHour<V>> {
        self.days
            .get(&local_day)
            .map(|v| v.iter().map(|i| &self.hours[*i]).collect())
            .unwrap_or_default()
    }
}
