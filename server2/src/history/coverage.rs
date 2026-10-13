//! Coverage decision for a cell's history inputs (cold-cell clarification). A publication is
//! covered by a captured complete group or by a legacy export snapshot taken after it; anything
//! else keeps the request on legacy with the gaps named. ASOS and station data never cover a
//! grid hour, and no hour is synthesized.
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
#[derive(Debug, Clone, Default)]
pub struct CoverageConfig {
    /// Legacy `ASOS_HISTORY_READ_ENABLED`: ASOS-merged fields cannot be reproduced here.
    pub legacy_asos_read: bool,
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
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegacyReason {
    Gaps,
    AsosRead,
    IndexIncomplete,
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
    /// Only the newest per-cell publications are missing; a request-time fetch may supply them.
    NeedsLatest {
        plan: HistoryPlan,
        missing: Vec<(Family, Publication)>,
    },
    /// Forward to legacy.
    Legacy {
        reason: LegacyReason,
        cold: ColdCell,
        gaps: Vec<Gap>,
    },
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

/// Decide whether `request` can be served from S3 inputs or must stay on legacy.
pub fn coverage(
    request: &HistoryRequest,
    index: &CaptureIndex,
    config: &CoverageConfig,
) -> Coverage {
    let legacy = |reason, cold, gaps| Coverage::Legacy { reason, cold, gaps };
    if config.legacy_asos_read {
        return legacy(LegacyReason::AsosRead, ColdCell::NotCold, Vec::new());
    }
    let at = request.at_ms;
    let mut families = BTreeMap::new();
    let mut gaps = Vec::new();
    let mut latest_missing = Vec::new();
    let mut cell_present = 0usize;
    let mut cell_missing = 0usize;
    let station = request.station.map(ExportKey::Station);
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
            return legacy(LegacyReason::IndexIncomplete, ColdCell::NotCold, Vec::new());
        }
        let slots: Vec<SlotInput> = required
            .iter()
            .map(|p| SlotInput {
                publication: *p,
                captured: index.has(family, target, *p),
                exports: covering_exports(index, family, key, *p),
            })
            .collect();
        let mut family_gaps = gaps_of(family, &slots);
        if family.per_cell() {
            let missing: usize = family_gaps.iter().map(|g| g.missing).sum();
            cell_missing += missing;
            cell_present += slots.len() - missing;
            // Only the newest publication missing: a request-time fetch may supply it.
            if let [only] = family_gaps.as_slice()
                && only.missing == 1
                && Some(only.last) == required.last().copied()
            {
                latest_missing.push((family, only.last));
                family_gaps.clear();
            }
        }
        gaps.extend(family_gaps);
        families.insert(family, slots);
    }
    if let Some(anchor) = request.minute_anchor {
        let (after, through) = schedule::minute_window(anchor);
        if [after.date(), through.date()].iter().any(|d| {
            index.is_incomplete(Family::AwsMinute.kind(), *d)
                || (station.is_some() && index.is_incomplete(LegacyKind::StnMinute2.kind(), *d))
        }) {
            return legacy(LegacyReason::IndexIncomplete, ColdCell::NotCold, Vec::new());
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
                gaps.push(Gap {
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
    if !gaps.is_empty() {
        let cold = if cell_present == 0 {
            ColdCell::NeverCaptured
        } else if cell_missing > latest_missing.len() {
            ColdCell::Partial
        } else {
            ColdCell::NotCold
        };
        return legacy(LegacyReason::Gaps, cold, gaps);
    }
    if latest_missing.is_empty() {
        Coverage::Complete(plan)
    } else {
        Coverage::NeedsLatest {
            plan,
            missing: latest_missing,
        }
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
