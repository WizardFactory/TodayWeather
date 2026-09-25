# Spec — issue-2576

| Field | Recorded value |
| --- | --- |
| Task / stage / owner | issue-2576 / spec / main (Claude Opus 5.5) |
| Date / revision | 2026-09-25 r1 |
| Consumed inputs | intent/issue-2576.md, reports/sdlc/issue-2576/{triage,investigation}.md |
| Acceptance criteria | AC1–AC6 |
| Status / decision | complete / PROCEED |

## Requirements
| ID | AC | Requirement |
|---|---|---|
| R1 | AC1 | `WeatherDescription.normalizeKmaWeatherStr(str)` runs before the `makeWeatherType` switch and rewrites: suffix `연속적`→`계속`, `단속적`→`단속`; exact `비끝`/`눈끝`→`…끝남`; `안개`→`안개변화무`; `(약한|보통|강한)?(이슬비|진눈깨비|소나기)(계속|단속)?` → legacy drizzle/sleet/shower form (default `보통`; sleet `약진눈깨비`/`강진눈깨비`/`진눈깨비`); `(약한|보통|강한)?(비|눈)(계속|단속)?` with at least a prefix or suffix → `<intensity|보통><base><suffix|계속>`. Bare `비`/`눈` stay unchanged (65/66). `구름적음` maps to 1. English and legacy strings are unaffected. `Fail weatherStr=` logs the original (lower-cased) string. |
| R2 | AC2 | `getWeatherStr` returns `""` for `undefined`, negative or out-of-range types, and logs `Unknown weatherType=` for out-of-range values. |
| R3 | AC3 | `updateWeather`: `weatherType < 0` is handled like `undefined` in both the pty ≥ 1 and pty 0 branches. |
| R4 | AC4 | `ControllerTown.prototype._hasWeatherText(current)` is true only when `weatherType >= 0` and `weather` is a non-empty string. `makeSummary` and `makeSummaryWeather` add the weather item only when it is true. Grades are unchanged. No per-request warn log. |
| R5 | AC5 | `server/test/offline/weather-desc.test.js` is registered in `run.js`. A route smoke drives the actual v000903 `/coord/:loc` middleware with station text (`비끝`, `약한비연속적`, an unmapped string) for DB 1.0/2.0 and asserts on `current.weather`, `weatherType`, `summary` and `summaryWeather`. CI runs the smoke. |
| R6 | AC6 | `docs/architecture/mobile-api.md` contains a "Current weather text and summary (#2576)" section. The operations note distinguishes the deployed f40002d7 from the repository fix. |

## Interfaces and data
No request/route change. Response change: when the type is unknown, `current.weather` and world `desc` are `""` (previously the field was omitted, because the value was `undefined`). Summary strings no longer contain `undefined`. There are no storage or `DB_DATA_VERSION` changes, and both DB formats flow through the same controllers.

## Failure behavior and observability
Unknown text degrades to sky/pty text. `Fail weatherStr=<original>` remains the signal to extend normalization. There are no retries, external calls or new state.

## Security
No new input surface. The regular expressions are anchored and linear.

## Alternatives
- Enumerate every wording in the switch (first revision). Rejected: incomplete and inconsistent across categories.
- Normalize in the collector before storage. Rejected: this would need a storage migration or double-format reads and would not fix already stored rows.

## Verification strategy
Red: the new regression on the base source. Green and post-refactor: the regression and the full `test:offline` on the candidate. Additional smoke: the route-level v000903 smoke (real middleware and parsers, synthetic model boundaries). Documents: link and claim checks. CI on the pushed head.

## Amendment r2 (2026-09-25; intent r2)
- **R3 (amended):** in `updateWeather`'s pty ≥ 1 `case 0–12` branch, when pty is 4 the text is `보통소나기`/25, 5 `약한비`/19, 6 `약진눈깨비`/29, 7 `약한눈`/33, in addition to the existing 1/2/3 → 65/64/66. This applies to every type 0–12 in this branch, including `-1`/`undefined` after they are set to 0. Unknown pty (for example 8) keeps the existing behaviour. With pty 0 and a sky outside 0–4, the type stays `-1` and `getWeatherStr` gives `""`.
- **R5 (amended):** the route smoke adds scenarios: unmapped text with stored pty 5 (→ 19); unmapped `…비…` text (station pty conversion → 1 → 65); unmapped text with invalid sky (→ `-1`, `weather ""`, no weather item in either summary). Every scenario asserts that no TypeError/ReferenceError/AssertionError is swallowed in logs. The smoke hook mirrors `if (stn.weather)` from `getStnHourlyAndMinRns`. CI also runs `weather-desc.test.js` on the Node 16/22 rss-offline matrix.
- **R6 (amended):** the `mobile-api.md` and operations-note fallback wording lists the pty mapping and the cases that stay `""`. The normalization list matches `normalizeKmaWeatherStr` exactly.
- Behavioural note: pty 4–7 with a legacy type in 0–12 (for example a mapped `맑음`) now also shows the precipitation text. This is intended: the branch only runs when pty ≥ 1.
