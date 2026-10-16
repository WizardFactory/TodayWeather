//! ASOS summaries: a station's daily row as legacy `lib/history` stores it (S15b-2 replay of
//! `policy.normalize` and `Store.save` over the station's data.go.kr daily acquisitions).
//! Complete when `taMin` and `taMax` are valid and ordered (`policy.complete`,
//! `server/lib/history/policy.js:86`); rain is optional.
use super::{InputId, Inputs, Source, Summary, SummaryKey, kst_midnight_ms};
use crate::domestic::asos::AsosKind;
use crate::domestic::kma::source::asos::{AsosFetched, replay};
use crate::domestic::kma::source::{Doc, Val};

const HOUR_MS: i64 = 3_600_000;

/// The input identity of one ASOS acquisition (its range of KST hours or days).
pub fn input_id(f: &AsosFetched) -> Option<InputId> {
    let (start, end) = match f.kind {
        AsosKind::Daily => (
            kst_midnight_ms(f.start.parse().ok()?)? + 1,
            kst_midnight_ms(f.end.parse().ok()?)? + 24 * HOUR_MS,
        ),
        AsosKind::Hourly => {
            let at = |k: &str| -> Option<i64> {
                Some(
                    kst_midnight_ms(k.get(..8)?.parse().ok()?)?
                        + k.get(8..10)?.parse::<i64>().ok()? * HOUR_MS,
                )
            };
            (at(&f.start)?, at(&f.end)?)
        }
    };
    let mut digest = Vec::new();
    for page in &f.pages {
        digest.extend_from_slice(crate::storage::sha256(page).as_bytes());
    }
    Some(InputId {
        family: f.kind.kind().to_owned(),
        start_ms: start,
        end_ms: end,
        fetched_at_ms: f.fetched_at_ms as u64,
        content_sha256: crate::storage::sha256(&digest),
    })
}

/// Complete ASOS summaries of `station` for `dates` from its acquisitions in fetch order.
pub fn summaries(station: &str, fetched: &[AsosFetched], dates: &[u32]) -> Vec<Summary> {
    let daily: Vec<AsosFetched> = fetched
        .iter()
        .filter(|f| f.kind == AsosKind::Daily)
        .cloned()
        .collect();
    if daily.is_empty() {
        return Vec::new();
    }
    let ids: Vec<InputId> = daily.iter().filter_map(input_id).collect();
    let store = replay(station, &daily, &[]);
    let mut out = Vec::new();
    for &date in dates {
        let key = format!("{date:08}");
        let Some(doc) = store
            .read(AsosKind::Daily, station, &key, &key)
            .into_iter()
            .next()
        else {
            continue;
        };
        let Some(values) = doc.get("values").and_then(Val::as_doc).map(Doc::json) else {
            continue;
        };
        if !super::complete(Source::Asos, &values) {
            continue;
        }
        out.push(Summary {
            key: SummaryKey::Asos {
                station: station.to_owned(),
            },
            date,
            grid: None,
            values,
            inputs: Inputs::of(ids.iter().filter(|id| id.concerns(date))),
        });
    }
    out
}
