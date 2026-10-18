//! Process-local admission for demand-triggered latest short forecasts (#2819 B3).
use crate::domestic::publication::Publication;
use crate::history::schedule;
use std::{collections::HashMap, sync::Mutex};

const MINUTE_MS: f64 = 60_000.;
const MAX_CELLS: usize = 65_536;

#[derive(Default)]
struct State {
    publication_ms: Option<i64>,
    cells: HashMap<String, u8>,
}

/// Keep only the newest admitted publication. Never evict a still-current cell:
/// that would make the same publication/window admissible again.
#[derive(Default)]
pub(super) struct LatestShort {
    state: Mutex<State>,
}

impl LatestShort {
    /// Called only by the creator of the existing owned publication flight.
    /// A late first demand consumes the highest elapsed slot, not missed slots.
    pub(super) fn claim(&self, cell: &str, publication: Publication, now_ms: f64) -> bool {
        let Some((publication_ms, slot)) = window(publication, now_ms) else {
            return false;
        };
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        match state.publication_ms {
            Some(current) if publication_ms < current => return false,
            Some(current) if publication_ms == current => {}
            _ => {
                state.publication_ms = Some(publication_ms);
                state.cells.clear();
            }
        }
        if let Some(previous) = state.cells.get_mut(cell) {
            if *previous >= slot {
                return false;
            }
            *previous = slot;
            return true;
        }
        if state.cells.len() >= MAX_CELLS {
            return false;
        }
        state.cells.insert(cell.to_owned(), slot);
        true
    }
}

fn window(publication: Publication, now_ms: f64) -> Option<(i64, u8)> {
    // Latest Short bases are 02/05/.../23 at HH00, provisioned at HH10.
    if publication.minute() != 0 || publication.hour() % 3 != 2 || !now_ms.is_finite() {
        return None;
    }
    let base = schedule::to_ms(publication);
    let elapsed = (now_ms - base as f64) / MINUTE_MS;
    if !(12. ..190.).contains(&elapsed) {
        return None;
    }
    let slot = if elapsed >= 20. {
        3
    } else if elapsed >= 15. {
        2
    } else {
        1
    };
    Some((base, slot))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn base() -> Publication {
        Publication::new(20261018, 200).unwrap()
    }
    fn at(p: Publication, minutes: f64) -> f64 {
        schedule::to_ms(p) as f64 + minutes * MINUTE_MS
    }

    #[test]
    fn boundaries_are_provision_plus_two_five_and_ten() {
        let p = base();
        assert_eq!(window(p, at(p, 11.999)), None);
        for (minute, slot) in [
            (12., 1),
            (14.999, 1),
            (15., 2),
            (19.999, 2),
            (20., 3),
            (189.999, 3),
        ] {
            assert_eq!(window(p, at(p, minute)), Some((schedule::to_ms(p), slot)));
        }
        assert_eq!(window(p, at(p, 190.)), None);
        assert_eq!(window(p, f64::NAN), None);
        assert_eq!(window(p, f64::INFINITY), None);
    }
    #[test]
    fn late_first_demand_consumes_only_the_last_elapsed_slot() {
        let g = LatestShort::default();
        let p = base();
        assert!(g.claim("60-127", p, at(p, 40.)));
        for minute in [12., 15., 20., 40., 100., 189.] {
            assert!(!g.claim("60-127", p, at(p, minute)));
        }
        assert!(g.claim("61-127", p, at(p, 40.)), "independent cell");
    }
    #[test]
    fn new_base_resets_cells_but_older_publication_cannot_reset_it() {
        let g = LatestShort::default();
        let p = base();
        for minute in [12., 15., 20.] {
            assert!(g.claim("60-127", p, at(p, minute)));
        }
        let next = p.add_hours(3).unwrap();
        assert!(g.claim("60-127", next, at(next, 12.)));
        assert!(
            !g.claim("new-cell", p, at(p, 20.)),
            "clock rollback fails closed"
        );
        assert!(!g.claim("60-127", next, at(next, 12.)));
        assert!(g.claim("60-127", next, at(next, 15.)));
    }
    #[test]
    fn full_map_preserves_existing_claims_until_the_next_base() {
        let g = LatestShort::default();
        let p = base();
        for n in 0..MAX_CELLS {
            assert!(g.claim(&n.to_string(), p, at(p, 12.)));
        }
        assert!(!g.claim("overflow", p, at(p, 12.)));
        assert!(g.claim("0", p, at(p, 15.)));
        assert!(!g.claim("0", p, at(p, 15.)));
        let next = p.add_hours(3).unwrap();
        assert!(g.claim("overflow", next, at(next, 12.)));
        assert_eq!(g.state.lock().unwrap().cells.len(), 1);
    }
}
