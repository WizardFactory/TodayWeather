# Plan: Forecast rain/snow amounts with defined periods — issue 2583 (D45)

Revision 1, 2026-09-26. Consumes [intent](../intent/issue-2583.md) r1 and [spec](../specs/issue-2583.md) r1. Design skipped: no component, route or middleware-order change; the domestic-assembly diagram (`docs/rewrite/diagrams/server-domestic-assembly.json`) stays accurate. Owner: main agent (builder). Branch `fix/2583-forecast-precip-periods` from `master` `caaa21fe`, pushed to `ak-fork`, PR to `WizardFactory/TodayWeather` `master`.

## File operations

| File | Change | Req |
| --- | --- | --- |
| `server/lib/kmaPrecipitation.js` (new) | Parser, read/total/format, WeakMap-kept totals, assign/finalize | R1 |
| `server/lib/collectTownForecast.js` | PCP/SNO/RN1 via parser; text fields; drop `parseMeasurement` use for these | R2 |
| `server/models/modelShort.js`, `models/kma/kma.town.short.model.js`, `models/modelShortest.js`, `models/kma/kma.town.shortest.model.js` | Text fields | R3 |
| `server/controllers/controllerManager.js` | DB 1.0 per-field merge of text | R3 |
| `server/controllers/kma/kma.town.short.controller.js`, `kma.town.shortest.controller.js` | Read projection of text; shortest `assign` | R3 |
| `server/controllers/controllerTown.js` | `_getTownDataFromDB` text projection; `getShort` slot aggregation; RSS labelling; shortest slot totals; daily totals; strings | R3–R5, R7, R8 |
| `server/controllers/controllerTown24h.js` | `adjustShort` rewrite of the amount part | R6 |
| `server/test/offline/precipitation.test.js` (new) | Unit tests | AC1–AC3, AC5, AC6, AC8 |
| `server/test/offline/precipitation-smoke.js` (new) | Route smoke with the mixed-period fixture | AC4 |
| `server/test/offline/gather-code-drift.test.js`, `harness.js` | Category expectations, no-split regression, new dependency | AC2, AC1 |
| `server/test/offline/run.js`, `.github/workflows/rss-offline.yml` | Register test and smoke on Node 16/22 | AC7 |
| `docs/architecture/mobile-api.md`, `docs/rewrite/client-data-contracts.md`, `docs/architecture/gather-source-reconciliation.md`, `docs/rewrite/domain-glossary.md`, `docs/rewrite/decisions-and-open-questions.md`, `docs/rewrite/verification-matrix.md`, `server/test/offline/README.md` | Contract, period, hold condition, strings, D45, V41, test docs | AC8 |
| `intent/`, `specs/`, `plans/issue-2583.md`, `reports/sdlc/issue-2583/` | SDLC artifacts | — |

Boundaries: no route order, client, widget, web, current-observation parser, unit-conversion defect or `extendedRows` change.

## Order

1. Write `precipitation.test.js`, `precipitation-smoke.js` and the updated gather tests first.
2. Red on a clean `git archive` of `caaa21fe` plus the new tests (expected causes: missing `lib/kmaPrecipitation.js`; route smoke slot 18h `r06 1 ≠ 7`, `pty 3` slot `s06 40`, daily 0 ≠ 10, `r06Str "~1mm"`; gather test: categories → -1, split 0.8).
3. Implement R1 → R2/R3 → R4/R5 → R6 → R7 → R8.
4. Green: unit test, gather tests, smoke (DB 1.0/2.0).
5. Post-refactor: full `test:offline`, RSS/daily/air/weather-desc/history smokes, `rss-wind` UTC and America/Los_Angeles, Node 16.20.2 and 22.22.2.
6. Docs; link check.
7. Commit, push, PR; CI; independent verification (fresh subagent); issue comment with the design decisions.

## Commands

Dependencies: `/tmp/tw-air-smoke/node_modules` (async 2.5.0, express 4.13.4, sprintf 0.1.5, xml2js 0.4.23, mongoose, mocha 2.5.3). Node 16: `/tmp/issue-2565-research/node-v16.20.2-linux-x64/bin/node`.

```sh
TZ=UTC NODE_PATH=/tmp/tw-air-smoke/node_modules node server/test/offline/precipitation.test.js
TZ=UTC NODE_PATH=/tmp/tw-air-smoke/node_modules node server/test/offline/precipitation-smoke.js
NODE_PATH=/tmp/tw-air-smoke/node_modules npm --prefix server run test:offline
```

## Migration, rollback, blast radius

No data migration; new optional schema fields. Rollback: revert the commit; stored text fields are ignored by old code. Blast radius: every KMA route response (`short[]` amounts and fields, daily amounts, strings), gather storage of `PCP`/`SNO`/`RN1`, and push/daily-summary code that reads `short`/`dailyData` amounts.

## Risk review

- What could break: installed apps now show slot totals (bigger numbers than today) — intended. Daily `r06` disappears for days where RSS overwrote a slot (newer RSS publication). Older API versions (`v000001`) now get slot totals and the new fields.
- Riskiest part: the kept-total `WeakMap` depends on row object identity through the middleware chain; the route smoke checks it end to end, including `convertUnits` and `insertStrForData`.
- Rejected alternative: value-based category inference (see spec).
- Proof: Red on base and Green on candidate for the same tests; route smoke on both DB versions; full offline regression on Node 16/22; independent verification.

## Gate

PROCEED within the pre-merge authority. PR review by another provider is skipped by AK and recorded as not satisfied.

## Amendment 1 — 2026-09-26

Follows spec amendment 1. Added file operations: `server/controllers/controllerManager.js` `MAX_SHORT_COUNT` 64 → 192; test dependency maps in `gather-smoke.js` (category `SNO` through XML → storage → read), `daily-harness.js`, `short-rss-daily.test.js`, `rss-wind.test.js`; docs `docs/rewrite/server-response-assembly.md` and `server-data-lifecycle.md`. SDLC reports stay local (`reports/sdlc/` is in `.gitignore`, as for #2578). Red was re-captured after the test restructuring so each behavior test fails on an assertion, not on the missing module.
