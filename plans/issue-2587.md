# Plan: Daily KMA weather without sunrise, sunset or UV — issue 2587

Revision 1, 2026-09-26. Consumes [intent](../intent/issue-2587.md) r1 and [spec](../specs/issue-2587.md) r1. Design skipped (no structure or flow change beyond one helper module). Owner: main agent (builder). Branch `fix/2587-riseset-uv` from `master` `caaa21fe`, pushed to the `ak-ongyeol/TodayWeather` fork, PR to `WizardFactory/TodayWeather` `master`.

## File operations

| File | Change | Req |
| --- | --- | --- |
| `server/lib/sunRiseSet.js` (new) | NOAA sunrise/sunset in KST | R1 |
| `server/controllers/controllerTown.js` | `getRiseSetInfo`: error handling, computed fill-in | R2 |
| `server/controllers/kasi.riseset.controller.js` | Key list and rotation, keyless errors, per-area continuation | R3, R4 |
| `server/lib/lifeIndexKmaRequester.js` | V5 UV request, pagination, slot fallback, rotation, daily conversion | R5, R6 |
| `server/test/offline/riseset-uv.test.js` (new) | Unit tests | AC2–AC4 |
| `server/test/offline/fixtures/uv-idx-v5.json` (new) | V5-format fixture (documented format, not a live recording) | AC4 |
| `server/test/offline/riseset-uv-smoke.js` (new), `rss-response-smoke.js` | Route smoke; harness options for real KASI controller, area/life-index rows and model errors (defaults unchanged) | AC1, AC5 |
| `server/test/offline/run.js`, `.github/workflows/rss-offline.yml`, `server/test/offline/README.md` | Register tests | AC6 |
| `docs/architecture/weather-collection.md`, `mobile-api.md`, `docs/rewrite/external-providers.md` | Provider and response notes | AGENTS.md |

## Order

1. Write tests and fixture. Red on base: unit test fails (missing module / legacy URL), smoke fails on missing `sunrise`.
2. Implement R1–R6. Green under TZ UTC, Asia/Seoul, America/Los_Angeles.
3. Regression: `test:offline`, RSS/air/weather-desc/daily smokes; Node 16.20.2 via `npx node@16.20.2` if available.
4. Commit, push, PR, CI, issue comment with operator follow-ups.

## Commands

```sh
npm install --prefix /tmp/tw-2587 --ignore-scripts --no-audit --no-fund async@2.5.0 express@4.13.4 sprintf@0.1.5 xml2js@0.4.23 mongoose@5.1.2 mocha@2.5.3
TZ=UTC NODE_PATH=/tmp/tw-2587/node_modules node server/test/offline/riseset-uv.test.js
TZ=UTC NODE_PATH=/tmp/tw-2587/node_modules node server/test/offline/riseset-uv-smoke.js
NODE_PATH=/tmp/tw-2587/node_modules npm --prefix server run test:offline
```

## Blast radius and rollback

Every KMA response's daily rows (new `sunrise`/`sunset` values), the gather host's KASI and UV jobs. Rollback by reverting the commit.

## Risk review

- Could break: a client expecting no sunrise on some rows (none found); UV storage if V5 values differ in meaning (same KMA UV index scale 0–11+).
- Riskiest part: V5 slot/format assumptions without a keyed call. Proof available: format fixture, tolerant parsing, failure leaves prior data.
- Gate: PROCEED within pre-merge authority. Other-provider review skipped by AK.
