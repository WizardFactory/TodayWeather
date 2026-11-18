# Android forecast re-entry measurements

[Issue #3033](https://github.com/WizardFactory/TodayWeather/issues/3033) · 2026-11-18

## Setup

- Galaxy S21+ (SM-G996N), Android 15, power saving on, 60 Hz, 1080×2400, 450 dpi, font scale 1.0, Korean, thermal status 0 at the start and end of each variant.
- Locally signed, profileable release variants with the same isolated application ID, no Internet permission and offline weather refresh failures. The probe seeded the regular weather cache with the [Seoul corpus payload](../../../android/core-domain/src/test/resources/corpus/inputs/kma-seoul.json), SHA-256 `75b92bbcfca72d79438021b4245c4efab4502f5954ba991d3b8c9e70d9578b17`. Each variant was freshly installed and removed afterward.
- Baseline app source at `dc908294`, whose Android tree equals the issue's `8dd57e3d` Android tree. Chart cache only applied the Hourly and Daily model reuse changes. Full change also prepared and cached SVG icons.
- Each batch used a new process. Seed Seoul and warm Hourly → Daily → Air → Hourly. For each of ten iterations, tap Daily, verify the chart block is visible, tap Air, verify its header, then reopen Hourly and verify the chart. Record frames with a VSYNC timestamp between the forecast tap invocation and its destination assertion. The fixture, warmup, route and probe were identical across the three variants. This focused route differs from the broader interaction sequence used for the historical issue figures.
- Frame overrun is `FrameMetrics.TOTAL_DURATION − DEADLINE` using each frame's reported deadline. Every row below has 20 entries and 40 frames across two batches with zero dropped callbacks. Percentiles use nearest rank across each tab's frames. The 50 ms count is per entry, including an entry once if any of its sampled frames crosses the threshold.

## Frame overruns

| Variant | Tab | Entries ≥50 ms, batches 1 + 2 | P50 (ms) | P95 (ms) | P99 / max (ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| Baseline | Daily | 8 + 9 = 17/20 | 0.7 | 72.5 | 90.4 |
| Baseline | Hourly | 6 + 5 = 11/20 | −1.3 | 79.2 | 99.9 |
| Chart cache only | Daily | 9 + 10 = 19/20 | 4.1 | 76.3 | 99.9 |
| Chart cache only | Hourly | 8 + 6 = 14/20 | −7.0 | 76.7 | 108.3 |
| Full change | Daily | 7 + 7 = 14/20 | 5.7 | 62.5 | 68.9 |
| Full change | Hourly | 0 + 0 = 0/20 | −5.2 | 44.6 | 46.2 |

## Forecast chart work

Counts and cumulative measured milliseconds across 20 warmed entries per tab. The probe measured the chart builders, asset open and bitmap decode separately. The baseline and chart-only SVG operations below ran inside draw. The full change performs zero SVG opens and decodes both inside draw and across the sampled warmed entry.

| Variant | Tab | Chart builds | SVG asset opens | SVG bitmap decodes |
| --- | --- | ---: | ---: | ---: |
| Baseline | Daily | 20 (13.48 ms) | 120 (6.64 ms) | 120 (188.25 ms) |
| Baseline | Hourly | 20 (31.32 ms) | 120 (8.09 ms) | 120 (240.09 ms) |
| Chart cache only | Daily | 0 | 120 (6.52 ms) | 120 (179.44 ms) |
| Chart cache only | Hourly | 0 | 120 (9.17 ms) | 120 (266.90 ms) |
| Full change | Daily | 0 | 0 | 0 |
| Full change | Hourly | 0 | 0 | 0 |

The chart cache removed builds in isolation. The frame measurements on that variant varied and showed no consistent gain. The full change lowered both tabs' P95 and removed ≥50 ms overruns in the sampled Hourly entries. Daily continued to overrun even with zero measured chart builds and SVG asset work. The samples cover one cached fixture and a small number of frames on one phone. A newly encountered SVG icon still loads synchronously during chart preparation.

## Daily detail icons

The first comparison above stops at `0a2abb55`. The final change also shares decoded Daily detail icons across cells and visits, using the existing 4 MiB cache. The Daily detail card still uses its original horizontal row.

We repeated the same warmed Seoul journey on the S21+, with two batches of ten entries per tab for each build. This comparison added separate probes for Daily detail icons, chart SVGs and other page images. The control was the prior PR version at `0a2abb55`. There were 40 sampled frames per tab per build, no dropped callbacks, and thermal status was 0 before and after each build.

| Build | Tab | Entries ≥50 ms, batches 1 + 2 | P50 (ms) | P95 (ms) | P99 / max (ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| Prior PR | Daily | 5 + 3 = 8/20 | −0.3 | 55.2 | 57.0 |
| With shared detail icons | Daily | 0 + 0 = 0/20 | −2.3 | 37.9 | 41.5 |
| Prior PR | Hourly | 0 + 0 = 0/20 | −9.3 | 43.6 | 45.6 |
| With shared detail icons | Hourly | 0 + 1 = 1/20 | −7.0 | 42.1 | 71.0 |

Over 20 Daily entries, the control opened 340 detail assets (17.05 ms cumulative) and decoded 340 bitmaps (328.77 ms). The final build recorded zero for both, removing about 16.4 ms of decode work per entry. Daily frame overrun P95 fell by 17.3 ms (31%). Both builds recorded zero chart builds and zero chart SVG opens or decodes on both warmed tabs. Hourly's other page icons accounted for 260 opens and 260 decodes in each build.

Use the control within each comparison when estimating the effect. The rate of long frames varied across runs on this phone. This experiment measured warmed visits with one fixture. A first encounter or cache eviction still allows synchronous preparation of the asset.
