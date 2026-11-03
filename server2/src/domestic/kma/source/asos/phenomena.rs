//! ASOS domestic phenomenon numbers -> the existing rain/mixed/snow categories.
//! Source: KMA ASOS hourly guide's domestic-code appendix (retrieved 2026-10-25).
//! Codes may be concatenated. Ambiguous/unsupported old three-digit codes and
//! unrepresentable precipitation (hail, ice needles, blowing snow) stay unknown.

fn modern(code: u16) -> bool {
    matches!(code, 1..=36 | 40..=48 | 50..=60 | 70..=75 | 80..=86 | 90..=92)
}

/// Only a unique code segmentation is accepted. Extended codes participate in
/// ambiguity detection but are not silently interpreted as modern phenomena.
pub(super) fn precipitation(text: &str) -> Option<f64> {
    let text = text.trim();
    if text.is_empty() || text.len() > 64 || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut paths = vec![0u8; text.len() + 1];
    let mut previous = vec![None; text.len() + 1];
    paths[0] = 1;
    for i in 0..text.len() {
        if paths[i] == 0 {
            continue;
        }
        for size in [2, 3] {
            let Some(part) = text.get(i..i + size) else {
                continue;
            };
            let Ok(code) = part.parse::<u16>() else {
                continue;
            };
            if !((size == 2 && modern(code)) || (size == 3 && (101..=143).contains(&code))) {
                continue;
            }
            let end = i + size;
            previous[end] = if paths[end] == 0 && paths[i] == 1 {
                Some((i, code))
            } else {
                None
            };
            paths[end] = paths[end].saturating_add(paths[i]).min(2);
        }
    }
    if paths[text.len()] != 1 {
        return None;
    }
    let (mut rain, mut snow, mut end) = (false, false, text.len());
    while end > 0 {
        let (start, code) = previous[end]?;
        match code {
            // Shower rain is rain; the existing hourly aggregator understands 1/2/3.
            1..=4 | 7 | 12 => rain = true,
            5 | 8 | 10 | 11 => snow = true,
            6 | 9 => {
                rain = true;
                snow = true;
            }
            13..=15 | 20..=22 | 86 | 101..=143 => return None,
            _ => (),
        }
        end = start;
    }
    Some(match (rain, snow) {
        (true, true) => 2.,
        (true, false) => 1.,
        (false, true) => 3.,
        (false, false) => 0.,
    })
}

#[cfg(test)]
mod tests {
    use super::precipitation;
    #[test]
    fn codes_and_concatenation_are_bounded_and_unambiguous() {
        for (raw, expected) in [
            ("1904", 1.),
            ("401901", 1.),
            ("05", 3.),
            ("06", 2.),
            ("0105", 2.),
            ("40", 0.),
            ("90", 0.),
            ("1970", 0.),
        ] {
            assert_eq!(precipitation(raw), Some(expected), "{raw}");
        }
        for raw in [
            "", "00", "4", "101", "101101", "14", "86", "A0", "01,05", "9999",
        ] {
            assert_eq!(precipitation(raw), None, "{raw}");
        }
        assert_eq!(precipitation(&"01".repeat(33)), None);
    }
}
