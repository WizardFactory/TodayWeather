# Plan: Air summary without a current AirKorea observation — issue 2578

Revision 1, 2026-09-25. Consumes [intent](../intent/issue-2578.md) r1 and [spec](../specs/issue-2578.md) r1. Design skipped (no structure/flow change). Owner: main agent (builder). Branch `fix/2578-air-summary-missing-data` from `master` `bd6640f2`, pushed to `ak-fork`, PR to `WizardFactory/TodayWeather` `master`.

## File operations

| File | Change | Req |
| --- | --- | --- |
| `server/controllers/controllerTown24h.js` | `makeSummaryAir`: `airInfo = current.arpltn`; return `""` if falsy | R1 |
| `server/controllers/controllerTown.js` | `makeSummary`: `current.arpltn \|\| {}` | R2 |
| `server/controllers/kecoController.js` | `_checkDateTime`: threshold on a copy | R3 |
| `server/test/offline/air-summary.test.js` (new) | Unit tests for R1–R3 | AC1–AC4 |
| `server/test/offline/air-summary-smoke.js` (new) | v000903 route smoke, DB 1.0/2.0 × missing/empty/fresh air | AC5 |
| `server/test/offline/rss-response-smoke.js` | Harness accepts optional `fixture.arpltnInfo` (default unchanged) | AC5 |
| `server/test/offline/run.js` | Add unit test to `test:offline` | AC6 |
| `.github/workflows/rss-offline.yml` | Run unit test and smoke on Node 16.20.2/22.22.2 | AC6 |
| `docs/architecture/mobile-api.md`, `server/test/offline/README.md` | Contract and test docs | AGENTS.md |
| `intent/`, `specs/`, `plans/issue-2578.md` | Tracked SDLC artifacts | — |

Boundaries kept: no weather-description, `updateWeather`, route, storage, client or widget changes (weather belongs to PR #2577).

## Order

1. Create the branch from base; carry over only the in-scope hunks from the superseded working tree; remove weather hunks and weather tests.
2. Red: run the unit test and smoke against a clean `git archive` copy of base with the new tests. Expected Red causes: `LOC_AIR_QUALITY_IS_GOOD` for missing `arpltn`; `aqiGrade` written onto `current`; a merged object for 10/12/20 h stations; smoke assertion `1.0/missing-air: air summary`.
3. Green: run the unit test on the candidate (UTC, Asia/Seoul, America/Los_Angeles).
4. Post-refactor: re-run after the final edits; Node 16.20.2.
5. Smoke: `air-summary-smoke.js` (real in-process route execution, synthetic boundaries).
6. Regression: `test:offline`, `rss-wind` UTC/LA, history/runtime, RSS and daily response smokes.
7. Commit, push, PR; read CI; independent verification in a fresh context; PR review recorded per AK decision.

## Commands

Dependencies in `/tmp/tw-air-smoke/node_modules` (async 2.5.0, express 4.13.4, sprintf 0.1.5, xml2js 0.4.23, mongoose 5.1.2, mocha 2.5.3).

```sh
TZ=UTC node server/test/offline/air-summary.test.js
TZ=UTC NODE_PATH=/tmp/tw-air-smoke/node_modules node server/test/offline/air-summary-smoke.js
NODE_PATH=/tmp/tw-air-smoke/node_modules npm --prefix server run test:offline
```

## Migration, rollback, blast radius

No migration. Rollback by reverting the commit. Blast radius: KMA `summaryAir`/`summary` text and which AirKorea station data is accepted in `getKeco` (stricter for the 2nd+ station).

## Risk review

- What could break: clients that assumed non-empty `summaryAir` (none found); screens showing air values from a 2nd/3rd station 8–24 h old now show none.
- Riskiest part: the stricter merge window hides stale values users previously saw.
- Rejected alternative: whitelisting grade keys while keeping the `current` fallback.
- Proof: Red on base and Green on candidate for the same tests, route smoke on both DB versions, full offline regression on Node 16/22, independent verification.

## Gate

PROCEED within the pre-merge authority. PR review cannot be satisfied (no other provider); recorded as NEEDS_HUMAN.
