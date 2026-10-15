//! Grid summaries: the legacy `getPastMid` day summaries of a requested town.
//!
//! `getPastMid` (`server/controllers/controllerTown.js:2697`) merges `_getDaySummaryList` rows
//! (`:5530`) of the current list from `_getTimeValue(9-7*24)` on (`:2677`). The current list at
//! that step already holds the grid current rows, the ultra-short sky repair, the station and
//! city corrections and the ASOS history recovery (`:1252`, `:1290`). The native assembly hands
//! a JSON copy of those rows to the recorder ([`crate::domestic::kma::assemble_capturing`]);
//! this module keeps the complete days.
use super::{GRID_MIN_HOURS, InputId, Inputs, Source, Summary, SummaryKey, add_days};
use crate::domestic::kma::source::asos::AsosFetched;
use crate::gateway::OrderedJson;

/// The station ASOS acquisitions a snapshot read (S15b-2), for ASOS summaries.
#[derive(Debug, Clone)]
pub struct AsosInputs {
    pub station: String,
    pub fetched: Vec<AsosFetched>,
}
/// What a complete snapshot read for one town: its identity, grid, the identities of every
/// input acquisition and the station's ASOS acquisitions.
#[derive(Debug, Clone)]
pub struct GridInputs {
    pub town: [String; 3],
    pub grid: (u16, u16),
    pub ids: Vec<InputId>,
    pub asos: Option<AsosInputs>,
}

/// The KST dates stored at `now_ms`: today-6 through today-1. Each has ended, and the 192-slot
/// current window, the 8-day station pages and the ASOS D-7..D-1 window cover all its hours.
/// Before 01:00 KST yesterday is left out: its `2400` hour is today's live `00:00` row, which
/// `getKmaStnMinuteWeather` still updates from the minute page (`short.rs`), so minute pages are
/// never a summary input.
pub fn dates(now_ms: f64) -> Vec<u32> {
    let now = crate::history::schedule::from_ms(now_ms as i64);
    let today = now.date();
    let last = if now.hour() == 0 { 2 } else { 1 };
    (last..=6)
        .rev()
        .filter_map(|d| add_days(today, -d))
        .collect()
}

/// Complete grid summaries among the `getPastMid` day rows.
pub fn summaries(inputs: &GridInputs, rows: &[OrderedJson], now_ms: f64) -> Vec<Summary> {
    let wanted = dates(now_ms);
    let mut out: Vec<Summary> = Vec::new();
    for row in rows {
        let Some(date) = row
            .get("date")
            .and_then(OrderedJson::string)
            .filter(|d| d.len() == 8)
            .and_then(|d| d.parse::<u32>().ok())
        else {
            continue;
        };
        if !wanted.contains(&date) || out.iter().any(|s| s.date == date) {
            continue;
        }
        let hours = row
            .get("observationHours")
            .and_then(OrderedJson::number)
            .unwrap_or(0.);
        if hours < GRID_MIN_HOURS || !super::complete(Source::Grid, row) {
            continue;
        }
        out.push(Summary {
            key: SummaryKey::Grid {
                town: inputs.town.clone(),
            },
            date,
            grid: Some(inputs.grid),
            values: row.clone(),
            inputs: Inputs::of(inputs.ids.iter().filter(|id| id.concerns(date))),
        });
    }
    out.sort_by_key(|s| s.date);
    out
}
