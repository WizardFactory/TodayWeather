//! Coverage decision for a cell's history inputs (cold-cell clarification, corrected by AK on
//! 2026-10-14). A publication is covered by a captured complete group or by a legacy export
//! snapshot taken after it. A missing publication never forwards the request to legacy:
//! - grid publications within the KMA backfill reach (the latest one plus 23 earlier current or
//!   ultra-short slots, 7 earlier short runs; data.go.kr serves about one day) and the station
//!   pages a request-time acquisition can still obtain are fetched;
//! - older current hours back to D-7 (KST) take the nearest ASOS city station's observations
//!   through the legacy #2564/#2648 history read (invalid or missing fields at exact hourly keys,
//!   with provenance and `historyStatus`);
//! - anything older has no source and stays absent, as legacy answers absent data.
//!
//! No grid hour is invented.
use super::{
    Grid,
    index::CaptureIndex,
    legacy::{self, ExportKey, LegacyKind},
    schedule::{self, Family, Target},
};
use crate::domestic::publication::Publication;
use crate::storage::{
    CatalogId, CatalogStore, CatalogTransport, CompleteAcquisition, Error, LookupOutcome,
    PageOutcome, ProviderKey, ReadCursor, ReadOrder, sha256,
};
use std::collections::BTreeMap;
use tokio::time::Instant;

const MINUTE_MS: i64 = 60_000;
/// Largest step between consecutive captured minute pages (2-minute cadence plus jitter).
pub const MINUTE_MAX_STEP_MS: i64 = 3 * MINUTE_MS;
/// The newest minute page must be at most this old at the anchor (legacy notes a 3-minute delay).
pub const MINUTE_FRESHNESS_MS: i64 = 3 * MINUTE_MS;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HistoryRequest {
    pub grid: Grid,
    /// Nearest legacy station chosen by the assembler (S15), if station inputs are used.
    pub station: Option<u32>,
    pub at_ms: i64,
    /// Legacy `_getStnMinute2` anchor; `None` skips the minute window.
    pub minute_anchor: Option<Publication>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlotInput {
    pub publication: Publication,
    pub captured: bool,
    /// Export snapshot instants (UTC ms) that include this publication.
    pub exports: Vec<i64>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MinutePlan {
    /// Exclusive start (`anchor - 20 min`).
    pub after: Publication,
    pub through: Publication,
    /// Captured pages strictly after `after`, ascending.
    pub captured: Vec<Publication>,
    pub exports: Vec<i64>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryPlan {
    pub families: BTreeMap<Family, Vec<SlotInput>>,
    /// The 192 legacy current-list slots.
    pub current_window: Vec<Publication>,
    pub yesterday: Publication,
    pub minute: Option<MinutePlan>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColdCell {
    /// No per-cell publication present in the lookback.
    NeverCaptured,
    /// Some but not all publications are present (resumed or partial history).
    Partial,
    /// Per-cell history is complete; the gap is elsewhere (national pages, minute window).
    NotCold,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Gap {
    pub family: Family,
    pub first: Publication,
    pub last: Publication,
    pub missing: usize,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Coverage {
    Complete(HistoryPlan),
    /// Only publications a request-time acquisition can obtain are missing (grid slots within
    /// the KMA backfill reach, station pages): fetch them, then the inputs are complete.
    NeedsLatest {
        plan: HistoryPlan,
        missing: Vec<(Family, Publication)>,
    },
    /// Older inputs are missing: the request is still served (no legacy forward) with
    /// `fetch` acquired, the `asos` hours left to the ASOS history read and `absent` gaps
    /// answered as legacy answers absent data.
    Fill {
        plan: HistoryPlan,
        cold: ColdCell,
        fetch: Vec<(Family, Publication)>,
        asos: Vec<Publication>,
        absent: Vec<Gap>,
    },
    /// A listing could not be read completely, so presence cannot be decided; the caller
    /// re-reads the index (and serves from what it holds meanwhile).
    IndexIncomplete,
}

fn export_kinds(family: Family) -> &'static [LegacyKind] {
    match family {
        Family::Current => &[LegacyKind::TownCurrent, LegacyKind::CurrentV1],
        Family::Shortest => &[LegacyKind::TownShortest, LegacyKind::ShortestV1],
        Family::Short => &[LegacyKind::TownShort, LegacyKind::ShortV1],
        Family::AwsHourly | Family::CityObs => &[LegacyKind::StnHourly2],
        Family::AwsMinute => &[LegacyKind::StnMinute2],
    }
}
/// Export snapshots that contain publication `p`: taken at `E` with
/// `E - retention <= p <= latest(family, E)`.
fn covering_exports(
    index: &CaptureIndex,
    family: Family,
    key: Option<ExportKey>,
    p: Publication,
) -> Vec<i64> {
    let Some(key) = key else {
        return Vec::new();
    };
    let at = schedule::to_ms(p);
    let mut out: Vec<i64> = export_kinds(family)
        .iter()
        .flat_map(|kind| index.exports(*kind, key))
        .filter(|e| {
            family.latest(*e).is_some_and(|l| at <= schedule::to_ms(l))
                && at >= e - legacy::retention_ms(family)
        })
        .collect();
    out.sort_unstable();
    out.dedup();
    out
}
fn gaps_of(family: Family, slots: &[SlotInput]) -> Vec<Gap> {
    let mut gaps: Vec<Gap> = Vec::new();
    let mut previous_missing = false;
    for s in slots {
        let missing = !s.captured && s.exports.is_empty();
        if missing {
            match gaps.last_mut() {
                Some(g) if previous_missing => {
                    g.last = s.publication;
                    g.missing += 1;
                }
                _ => gaps.push(Gap {
                    family,
                    first: s.publication,
                    last: s.publication,
                    missing: 1,
                }),
            }
        }
        previous_missing = missing;
    }
    gaps
}

/// How many publications before the latest a request-time acquisition can still obtain.
fn fetch_reach(family: Family) -> usize {
    match family {
        Family::Current => schedule::BACKFILL_CURRENT,
        Family::Shortest => schedule::BACKFILL_SHORTEST,
        Family::Short => schedule::BACKFILL_SHORT,
        // The AWS hourly table serves past hours; the city page serves only its latest hour.
        Family::AwsHourly => schedule::CURRENT_SLOTS - 1,
        Family::CityObs | Family::AwsMinute => 0,
    }
}
/// First hour of the ASOS history window (D-7 00:00 KST at `at_ms`).
pub fn asos_start(at_ms: i64) -> Publication {
    let today = schedule::from_ms(at_ms);
    Publication::new(today.date(), 0)
        .and_then(|d| d.add_hours(-7 * 24))
        .expect("calendar day")
}

/// Classify `request`'s history inputs (see the module docs; never a legacy forward).
pub fn coverage(request: &HistoryRequest, index: &CaptureIndex) -> Coverage {
    let at = request.at_ms;
    let mut families = BTreeMap::new();
    let mut absent = Vec::new();
    let mut fetch = Vec::new();
    let mut asos = Vec::new();
    let mut cell_present = 0usize;
    let mut cell_missing = 0usize;
    let station = request.station.map(ExportKey::Station);
    let asos_from = asos_start(at);
    for family in Family::PER_CELL.into_iter().chain(Family::NATIONAL_HOURLY) {
        let required = family.required(at);
        let (target, key) = if family.per_cell() {
            (
                Target::Cell(request.grid),
                Some(ExportKey::Grid(request.grid)),
            )
        } else {
            (Target::National, station)
        };
        // A listing that could not be read completely cannot prove presence or absence.
        if required.iter().any(|p| {
            index.is_incomplete(family.kind(), p.date())
                || export_kinds(family)
                    .iter()
                    .any(|k| index.is_incomplete(k.kind(), p.date()))
        }) {
            return Coverage::IndexIncomplete;
        }
        let slots: Vec<SlotInput> = required
            .iter()
            .map(|p| SlotInput {
                publication: *p,
                captured: index.has(family, target, *p),
                exports: covering_exports(index, family, key, *p),
            })
            .collect();
        let reach = fetch_reach(family);
        let mut unfilled = Vec::new();
        for (i, s) in slots.iter().enumerate() {
            let missing = !s.captured && s.exports.is_empty();
            if family.per_cell() {
                if missing {
                    cell_missing += 1;
                } else {
                    cell_present += 1;
                }
            }
            if !missing {
                continue;
            }
            let from_latest = slots.len() - 1 - i;
            if from_latest <= reach {
                fetch.push((family, s.publication));
            } else if family == Family::Current && s.publication >= asos_from {
                asos.push(s.publication);
            } else {
                unfilled.push(s.clone());
            }
        }
        // Gaps of the unfilled slots only (consecutive in the required order).
        let marks: Vec<SlotInput> = slots
            .iter()
            .map(|s| SlotInput {
                publication: s.publication,
                captured: !unfilled.iter().any(|u| u.publication == s.publication),
                exports: Vec::new(),
            })
            .collect();
        absent.extend(gaps_of(family, &marks));
        families.insert(family, slots);
    }
    if let Some(anchor) = request.minute_anchor {
        let (after, through) = schedule::minute_window(anchor);
        if [after.date(), through.date()].iter().any(|d| {
            index.is_incomplete(Family::AwsMinute.kind(), *d)
                || (station.is_some() && index.is_incomplete(LegacyKind::StnMinute2.kind(), *d))
        }) {
            return Coverage::IndexIncomplete;
        }
    }
    let minute = request.minute_anchor.map(|anchor| {
        let (after, through) = schedule::minute_window(anchor);
        // An export snapshot holds the whole window only if it was taken at or after the anchor
        // and the legacy one-day minute retention still includes the window start.
        let exports: Vec<i64> = station
            .map(|s| index.exports(LegacyKind::StnMinute2, s))
            .unwrap_or_default()
            .into_iter()
            .filter(|e| {
                *e >= schedule::to_ms(through)
                    && *e - legacy::retention_ms(Family::AwsMinute) <= schedule::to_ms(after)
            })
            .collect();
        let captured: Vec<Publication> = index
            .minutes()
            .filter(|m| *m > after && *m <= through)
            .collect();
        (
            MinutePlan {
                after,
                through,
                captured,
                exports,
            },
            minute_continuous(index, after, through),
        )
    });
    let minute = match minute {
        Some((plan, continuous)) => {
            if plan.exports.is_empty() && !continuous {
                // The latest minute page can be fetched; earlier pages of the window cannot.
                fetch.push((Family::AwsMinute, plan.through));
                absent.push(Gap {
                    family: Family::AwsMinute,
                    first: plan.after,
                    last: plan.through,
                    missing: 1,
                });
            }
            Some(plan)
        }
        None => None,
    };
    let plan = HistoryPlan {
        families,
        current_window: schedule::current_window(at),
        yesterday: schedule::yesterday(schedule::hour_of(at)),
        minute,
    };
    if absent.is_empty() && asos.is_empty() {
        return if fetch.is_empty() {
            Coverage::Complete(plan)
        } else {
            Coverage::NeedsLatest {
                plan,
                missing: fetch,
            }
        };
    }
    let cold = if cell_present == 0 {
        ColdCell::NeverCaptured
    } else if cell_missing > 0 {
        ColdCell::Partial
    } else {
        ColdCell::NotCold
    };
    Coverage::Fill {
        plan,
        cold,
        fetch,
        asos,
        absent,
    }
}
/// Captured minutes reach back to the window start, never step more than 3 minutes, and the
/// newest is at most 3 minutes older than the anchor.
fn minute_continuous(index: &CaptureIndex, after: Publication, through: Publication) -> bool {
    let start = schedule::to_ms(after);
    let end = schedule::to_ms(through);
    let pages: Vec<i64> = index
        .minutes()
        .map(schedule::to_ms)
        .filter(|m| *m <= end && *m > start - MINUTE_MAX_STEP_MS)
        .collect();
    let (Some(first), Some(last)) = (pages.first(), pages.last()) else {
        return false;
    };
    *first <= start
        && end - last <= MINUTE_FRESHNESS_MS
        && pages.windows(2).all(|w| w[1] - w[0] <= MINUTE_MAX_STEP_MS)
}

/// The S06 catalog of one captured publication (data.go.kr by publication, KMA pages by day).
pub fn catalog_id(
    family: Family,
    target: Target,
    publication: Publication,
) -> Result<CatalogId, Error> {
    let key = match target {
        Target::Cell(grid) => grid.provider_key(),
        Target::National => ProviderKey::Named {
            id: if family == Family::CityObs {
                "city-national"
            } else {
                "aws-national"
            }
            .into(),
        },
    };
    let partition = if family.source() == "data-go-kr" {
        publication.partition()
    } else {
        publication.base_date()
    };
    let id = CatalogId {
        source: family.source().into(),
        kind: family.kind().into(),
        key_sha256: sha256(&key.canonical_bytes()?),
        partition,
    };
    id.validate()?;
    Ok(id)
}
/// Every complete acquisition of one publication, in S06 revision order. `None` when the
/// catalog is missing or incomplete (the caller forwards to legacy and may repair). National
/// pages share a KST-day catalog, so they are read in bounded latest-first pages.
pub async fn read_slot<T: CatalogTransport>(
    store: &CatalogStore<T>,
    family: Family,
    target: Target,
    publication: Publication,
    deadline: Instant,
) -> Result<Option<Vec<CompleteAcquisition>>, Error> {
    let id = catalog_id(family, target, publication)?;
    if family.source() == "data-go-kr" {
        return match store.lookup(&id, deadline).await {
            Ok(LookupOutcome::Ready(set)) => Ok(Some(set.acquisitions().to_vec())),
            Ok(LookupOutcome::Incomplete) | Err(Error::NotFound) => Ok(None),
            Err(e) => Err(e),
        };
    }
    let period = publication.period();
    let mut found = Vec::new();
    let mut cursor: Option<ReadCursor> = None;
    for _ in 0..NATIONAL_PAGES {
        let page = match store
            .lookup_page(&id, ReadOrder::EarliestFirst, cursor.as_ref(), 32, deadline)
            .await
        {
            Ok(PageOutcome::Ready(page)) => page,
            Ok(PageOutcome::Incomplete) | Err(Error::NotFound) => return Ok(None),
            Err(e) => return Err(e),
        };
        found.extend(
            page.acquisitions()
                .iter()
                .filter(|a| {
                    a.records()
                        .first()
                        .is_some_and(|r| r.envelope.identity.period == period)
                })
                .cloned(),
        );
        match page.next() {
            Some(next) => cursor = Some(next.clone()),
            None => return Ok((!found.is_empty()).then_some(found)),
        }
    }
    // A day catalog larger than the page bound cannot be proven fully read.
    Ok(None)
}
/// Upper bound on 32-acquisition pages read from one national day catalog.
const NATIONAL_PAGES: usize = 64;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gaps_merge_consecutive_missing_slots() {
        let p = |t| Publication::new(20261013, t).unwrap();
        let slot = |t, ok: bool| SlotInput {
            publication: p(t),
            captured: ok,
            exports: Vec::new(),
        };
        let gaps = gaps_of(
            Family::Current,
            &[
                slot(100, true),
                slot(200, false),
                slot(300, false),
                slot(400, true),
                slot(500, false),
            ],
        );
        assert_eq!(gaps.len(), 2);
        assert_eq!(
            (gaps[0].first, gaps[0].last, gaps[0].missing),
            (p(200), p(300), 2)
        );
        assert_eq!((gaps[1].first, gaps[1].missing), (p(500), 1));
    }
}
