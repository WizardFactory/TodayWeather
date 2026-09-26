# Intent: Forecast rain/snow amounts with defined periods — issue 2583 (D45)

Revision 1, 2026-09-26. Owner: main agent for AK. Source: AK request and issue [#2583](https://github.com/WizardFactory/TodayWeather/issues/2583). Triage and later evidence: local task reports under `reports/sdlc/issue-2583/` (ignored by `.gitignore`).

## Problem

Since `VilageFcstInfoService_2.0`, `PCP`, `SNO` and forecast `RN1` are hourly values, often given as categories (`1mm 미만`, `30.0~50.0mm`, `50.0mm 이상`). The service still treats `r06`/`s06` like the retired six-hour feed. `getShort` drops the hourly rows between 3-hour slots, `adjustShort` samples one hourly value every six hours and splits it across two slots, a `pty 3` shortest-window slot puts rain mm in `s06` (then ×10), daily sums add these mixed values, and `r06Str` uses the retired 1/5/10/20/40/70/100 table. Rain is undercounted in `/weather/v000903/coord`. The mobile apps show `r06`/`s06` as amounts (`client/www/js/app.js`, `controller.forecastctrl.js`); the web PWA hides them (#2582). The period contract in `gather-source-reconciliation.md` holds hourly-feed activation until this is repaired.

## Desired outcome and acceptance criteria

- AC1: Offline test: hourly `PCP` values 2, 4 and 1 inside one 3-hour slot give that slot `r06 = 7` with a 3-hour period, and no other slot receives any part of them.
- AC2: Offline test: category parsing maps `강수없음` → 0; `1mm 미만` → an approximate value below 1 mm; `30.0~50.0mm` → bounds 30–50; `50.0mm 이상` → at least 50. The equivalent snow strings in cm (`적설없음`, `1cm 미만`, `a~bcm`, `5.0cm 이상`) parse the same way. The collector stores a representative amount plus the category, not `-1`.
- AC3: Offline test: a `pty 3` slot in the shortest window keeps its rain in `r06`, and its `s06` is not a ×10 rain value.
- AC4: A mixed-period fixture (verification matrix V41: past observed rows, shortest window and hourly `PCP` rows in one response) passes AC1, AC3, AC5 and AC6 through the real v000903 coordinate router on DB 1.0 and 2.0.
- AC5: Offline test: a day's `midData.dailyData[].r06` equals the sum of that day's hourly forecast values.
- AC6: Offline test: an amount of 10 mm does not produce `r06Str` `5~9mm`; strings come from the parsed category.
- AC7: `npm --prefix server run test:offline` passes on Node 16.20.2 and 22.22.2 (locally and in CI).
- AC8: The response states each forecast amount's accumulation period and whether it is a category approximation. The fields are documented in `docs/architecture/mobile-api.md` and `docs/rewrite/client-data-contracts.md`. Existing field names stay, and both `DB_DATA_VERSION` 1.0 and 2.0 store and read the category.

Post-deployment (human-owned, not verified here): the Gwangju/Busan responses from the issue show slot sums with periods, and the activation hold in `gather-source-reconciliation.md` can be lifted after the gather host runs the new parser.

## Scope

In scope: collector parsing of `PCP`/`SNO`/forecast `RN1`; storage of the category text in both DB versions (schemas and legacy per-field save); `getShort` slot aggregation; RSS six-hour amounts labelled as such; `ControllerTown24h.adjustShort` (remove sampling/splitting, shortest-window rain into `r06`); daily sums; rain/snow strings; response fields; offline tests and CI registration; architecture and rewrite docs, including lifting the documented activation-hold condition text.

Out of scope: client, widget and web changes; current-observation `RN1` parsing (numeric); the precipitation-unit conversion that passes `toWindUnit` (separate defect, noted); days beyond the short template (`extendedRows` from snapshots carry no amounts); DB migration or backfill; production deployment, gather-host rollout and the operator decision to lift the hold.

## Constraints

Node 16.20.2 runtime; `DB_DATA_VERSION` 1.0 and 2.0; older app versions keep reading `r06`/`s06`/`rn1` as amounts and treat negative values as printable (keep response amounts ≥ 0 where they were before); no provider/DB access in tests; AGENTS.md verification and documentation rules.

## Authority and endpoint

Endpoint pre-merge (AK, 2026-09-26). Covered: implementation, tests, smoke, commits, branch push to `ak-ongyeol/TodayWeather` (remote `ak-fork`), PR against `WizardFactory/TodayWeather` `master`, CI reading, corrections, independent verification by a fresh subagent context, and a concise issue comment if needed. Excluded: merge, auto-merge, merge queue, production deployment, permission changes, credential transfer, new accounts. AK decision: skip the other-provider PR reviewer; the review gate stays incomplete and is reported, not claimed.

## Risks and open questions

- Representative amounts for categories are a choice: half the threshold for `N 미만`, the midpoint for `a~b`, the lower bound for `N 이상`. The approximation flag and the string carry the uncertainty.
- Hourly value window: this task keeps the service's end-labelled slot convention (hours T-2, T-1, T form slot T).
- Mixed deployment: a service with this change reading rows from the old gather parser sees `parseFloat` values without category text and treats them as exact.
- Displayed values change for installed apps (sums instead of halves), which is the intended fix.

## Consumers

Spec, plan, builder, independent verifier, PR description, completion.
