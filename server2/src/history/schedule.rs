//! Capture families, legacy history windows and the demand-gated capture plan (O-1, O-11).
//! Pure: callers pass UTC milliseconds; publications are KST (`domestic::publication`).
use super::{Grid, index::CaptureIndex};
use crate::domestic::publication::{self, Publication};
use std::collections::BTreeSet;
use time::{Date, Month, PrimitiveDateTime, Time, UtcOffset};

const MINUTE_MS: i64 = 60_000;
const HOUR_MS: i64 = 3_600_000;
/// Legacy `PastConditionGather` refills up to 23 earlier hourly current slots.
pub const BACKFILL_CURRENT: usize = 23;
/// data.go.kr serves about one day of ultra-short and short publications.
pub const BACKFILL_SHORTEST: usize = 23;
pub const BACKFILL_SHORT: usize = 7;
/// Station minute page cadence (legacy every even minute; O-11).
pub const MINUTE_INTERVAL_MS: i64 = 2 * MINUTE_MS;
/// Hourly-family capture checks (legacy current checks at minutes 2/12/22/...).
pub const TICK_INTERVAL_MS: i64 = 10 * MINUTE_MS;
/// Legacy `updateCurrentListForValidation` keeps the last 192 hourly slots.
pub const CURRENT_SLOTS: usize = 192;
pub const MINUTE_WINDOW_MS: i64 = 20 * MINUTE_MS;

fn kst() -> UtcOffset {
    UtcOffset::from_hms(9, 0, 0).expect("KST offset")
}
/// UTC milliseconds of a KST publication instant.
pub fn to_ms(p: Publication) -> i64 {
    let date = Date::from_calendar_date(
        (p.date() / 10000) as i32,
        Month::try_from(((p.date() / 100) % 100) as u8).expect("validated month"),
        (p.date() % 100) as u8,
    )
    .expect("validated date");
    let time = Time::from_hms(p.hour() as u8, p.minute() as u8, 0).expect("validated time");
    PrimitiveDateTime::new(date, time)
        .assume_offset(kst())
        .unix_timestamp()
        * 1000
}
/// The KST minute containing `ms` (seconds truncated).
pub fn from_ms(ms: i64) -> Publication {
    let t = time::OffsetDateTime::from_unix_timestamp(ms.div_euclid(1000))
        .expect("bounded instant")
        .to_offset(kst());
    Publication::new(
        t.year() as u32 * 10000 + u8::from(t.month()) as u32 * 100 + t.day() as u32,
        t.hour() as u16 * 100 + t.minute() as u16,
    )
    .expect("calendar instant")
}
fn add_minutes(p: Publication, minutes: i64) -> Publication {
    from_ms(to_ms(p) + minutes * MINUTE_MS)
}
/// The KST hour containing `at_ms`.
pub fn hour_of(at_ms: i64) -> Publication {
    from_ms(at_ms).hour_start()
}
/// The 192 slots the legacy current list holds at `at_ms`: hour(t)-191h ..= hour(t).
pub fn current_window(at_ms: i64) -> Vec<Publication> {
    let hour = hour_of(at_ms);
    (0..CURRENT_SLOTS as i64)
        .rev()
        .map(|i| add_minutes(hour, -60 * i))
        .collect()
}
/// The slot exactly 24 hours earlier (legacy yesterday comparison).
pub fn yesterday(slot: Publication) -> Publication {
    add_minutes(slot, -24 * 60)
}
/// Daily-summary attribution: `0000` belongs to the previous day as `2400`.
pub fn day_attribution(slot: Publication) -> (u32, u16) {
    if slot.time() == 0 {
        (add_minutes(slot, -24 * 60).date(), 2400)
    } else {
        (slot.date(), slot.time())
    }
}
/// Legacy `_getStnMinute2` window `(anchor - 20 min, anchor]`.
pub fn minute_window(anchor: Publication) -> (Publication, Publication) {
    (add_minutes(anchor, -20), anchor)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Family {
    /// `ultra-srt-ncst` per cell, hourly HH00.
    Current,
    /// `ultra-srt-fcst` per cell, hourly HH30 stored under the canonical HH00 (#2676).
    Shortest,
    /// `vilage-fcst` per cell, 02,05,...,23 HH00.
    Short,
    /// National AWS hourly page.
    AwsHourly,
    /// National city observation page.
    CityObs,
    /// National AWS minute page (latest only).
    AwsMinute,
}
impl Family {
    pub const PER_CELL: [Family; 3] = [Family::Current, Family::Shortest, Family::Short];
    pub const NATIONAL_HOURLY: [Family; 2] = [Family::AwsHourly, Family::CityObs];
    pub fn source(self) -> &'static str {
        match self {
            Self::Current | Self::Shortest | Self::Short => "data-go-kr",
            _ => "kma-web",
        }
    }
    pub fn kind(self) -> &'static str {
        match self {
            Self::Current => "ultra-srt-ncst",
            Self::Shortest => "ultra-srt-fcst",
            Self::Short => "vilage-fcst",
            Self::AwsHourly => "aws-hourly",
            Self::CityObs => "city-obs",
            Self::AwsMinute => "aws-minute",
        }
    }
    pub fn per_cell(self) -> bool {
        Self::PER_CELL.contains(&self)
    }
    /// Latest publication available at `now_ms` (legacy query-time helpers), canonical form.
    pub fn latest(self, now_ms: i64) -> Option<Publication> {
        match self {
            Self::Current => publication::current_base(now_ms),
            Self::Shortest => publication::ultra_short_base(now_ms).map(Publication::hour_start),
            Self::Short => publication::short_base(now_ms),
            Self::AwsHourly | Self::CityObs => publication::observation_hour(now_ms),
            Self::AwsMinute => None,
        }
    }
    /// The publication before `p` in this family's cadence.
    pub fn previous(self, p: Publication) -> Publication {
        match self {
            Self::Short => add_minutes(p, -180),
            _ => add_minutes(p, -60),
        }
    }
    /// First instant (UTC ms) of the required lookback at `at_ms`.
    fn lookback_start(self, at_ms: i64) -> i64 {
        let hour = to_ms(hour_of(at_ms));
        match self {
            Self::Short => hour - 195 * HOUR_MS,
            _ => hour - (CURRENT_SLOTS as i64 - 1) * HOUR_MS,
        }
    }
    /// Required publications at `at_ms`, ascending, ending at the latest one.
    pub fn required(self, at_ms: i64) -> Vec<Publication> {
        let Some(latest) = self.latest(at_ms) else {
            return Vec::new();
        };
        let start = self.lookback_start(at_ms);
        let mut out = Vec::new();
        let mut p = latest;
        while to_ms(p) >= start {
            out.push(p);
            p = self.previous(p);
        }
        out.reverse();
        out
    }
    /// The S13 request publication for a canonical one (ultra-short asks for HH30).
    pub fn request_publication(self, canonical: Publication) -> Publication {
        if self == Self::Shortest {
            Publication::new(canonical.date(), canonical.hour() * 100 + 30)
                .expect("HH30 of a valid hour")
        } else {
            canonical
        }
    }
    fn backfill(self) -> usize {
        match self {
            Self::Current => BACKFILL_CURRENT,
            Self::Shortest => BACKFILL_SHORTEST,
            Self::Short => BACKFILL_SHORT,
            Self::AwsHourly | Self::CityObs => CURRENT_SLOTS - 1,
            Self::AwsMinute => 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Target {
    Cell(Grid),
    National,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Planned {
    pub family: Family,
    pub target: Target,
    /// Canonical publication (ultra-short as HH00).
    pub publication: Publication,
    pub backfill: bool,
}

/// Captures due at `now_ms` for the active demand cells, skipping present publications.
/// Order: latest per-cell, latest national, per-cell backfill (newest first), national backfill.
/// Without demand the plan is empty: no all-grid timer and no national pages.
pub fn plan(now_ms: i64, active: &BTreeSet<Grid>, index: &CaptureIndex) -> Vec<Planned> {
    plan_with(now_ms, active, index, active)
}
/// As [`plan`], with per-cell backfill limited to `backfill_cells` (the runner backfills every
/// active cell once per KST hour, like legacy `PastConditionGather`, and new cells at once).
/// National page backfill is keyless and bounded by the runner's per-tick cap.
pub fn plan_with(
    now_ms: i64,
    active: &BTreeSet<Grid>,
    index: &CaptureIndex,
    backfill_cells: &BTreeSet<Grid>,
) -> Vec<Planned> {
    let mut out = Vec::new();
    if active.is_empty() {
        return out;
    }
    let mut push = |family: Family, target: Target, publication: Publication, backfill: bool| {
        if !index.has(family, target, publication) {
            out.push(Planned {
                family,
                target,
                publication,
                backfill,
            });
        }
    };
    for cell in active {
        for family in Family::PER_CELL {
            if let Some(latest) = family.latest(now_ms) {
                push(family, Target::Cell(*cell), latest, false);
            }
        }
    }
    for family in Family::NATIONAL_HOURLY {
        if let Some(latest) = family.latest(now_ms) {
            push(family, Target::National, latest, false);
        }
    }
    let backfill = |family: Family,
                    target: Target,
                    push: &mut dyn FnMut(Family, Target, Publication, bool)| {
        let Some(mut p) = family.latest(now_ms) else {
            return;
        };
        for _ in 0..family.backfill() {
            p = family.previous(p);
            push(family, target, p, true);
        }
    };
    for cell in active.intersection(backfill_cells) {
        for family in Family::PER_CELL {
            backfill(family, Target::Cell(*cell), &mut push);
        }
    }
    for family in Family::NATIONAL_HOURLY {
        backfill(family, Target::National, &mut push);
    }
    out
}
