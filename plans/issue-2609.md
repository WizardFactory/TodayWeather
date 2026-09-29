# Plan: KMA warnings from WthrWrnInfoService and zone-coded town warnings — issue 2609

Revision 2, 2026-09-27. Consumes [intent](../intent/issue-2609.md) r1 and [spec](../specs/issue-2609.md) r2. r2: E2E is CommonJS (`kma-warning-client-e2e.js`) so NODE_PATH resolves Playwright; the rss-response-smoke harness gains optional `zoneRows` and `translate`; the legacy mocha controller test drops removed text-matching cases; new diagram `kma-warnings` indexed in the architecture README. Design: update of the existing weather-collection Archify diagram (warning collection flow changes). Owner: main agent (builder). Branch `fix/2609-kma-warning-api` from `master` `f950df29`, pushed to the `ak-ongyeol/TodayWeather` fork, PR to `WizardFactory/TodayWeather` `master`.

## File operations

| File | Change | Req |
| --- | --- | --- |
| `server/lib/kmaWarningRequester.js` (new) | Keys, URL, response classification, paging | R1 |
| `server/lib/kmaWarningCollector.js` (new) | Change detection, readiness/retry, type 1–4 documents, hourly resync, `t6` check | R2, R3 |
| `server/lib/kmaWarningZones.js` (new), `server/utils/data/kma_warning_zones.csv` (new) | Zone table, replay rules, town mapping | R3, R4 |
| `server/models/modelKmaSpecialWeatherZone.js` (new) | Zone state and sync marker | R3 |
| `server/models/modelKmaSpecialWeatherSituation.js` | `bulletin` field, code fixes, `warnVar`/`warnStress` mapping | R5 |
| `server/lib/kmaScraper.js` | `gatherSpecialWeatherSituation` delegates; remove `status.jsp` request/parsers | R2, AC10 |
| `server/controllers/kma.specialweather.controller.js` | `getCurrent` bulletin/comment; `getSpecialInfo` via zones; remove text matching | R6 |
| `server/test/offline/kma-warning.test.js` (new), `fixtures/kma-warning/*.json` (new) | Unit tests with recorded live responses | AC1–AC10 |
| `server/test/offline/kma-warning-smoke.js` (new) | Real Mongo + stub provider + real route/controller; optional HTTP server mode for E2E | AC3, AC4, AC6, AC12 |
| `server/test/offline/kma-warning-client-e2e.js` (new) | Playwright: `client/www` S12 screen and forecast summary | AC12 |
| `server/test/offline/run.js`, `.github/workflows/rss-offline.yml`, `server/test/offline/README.md` | Register unit test (CI) and document smoke/E2E commands | CI |
| `server/test/offline/rss-response-smoke.js` | Optional `zoneRows` (real special weather controller) and `translate` hooks; defaults unchanged | AC6, AC12 |
| `server/test/test.kma.specialweather.controller.js` | Drop cases for removed text matching | — |
| `docs/architecture/README.md`, `docs/rewrite/{data-model-reference,server-data-lifecycle,api-endpoint-catalog}.md`, `server/test/offline/README.md` | Index and contract updates | AGENTS.md |
| `docs/architecture/weather-collection.md`, `docs/architecture/diagrams/weather-collection.{json,html}`, `docs/rewrite/server-response-assembly.md` §8, `docs/rewrite/external-providers.md`, `docs/rewrite/decisions-and-open-questions.md` (A31) | Provider, flow and contract updates | AGENTS.md |

## Order

1. Record fixtures (live read-only, keys stripped): `getPwnStatus`, `getWthrWrnMsg`, `getWthrPwn`, `getWthrInfo`, `getWthrBrkNews`, `getPwnCd` excerpts (a 6-day window, and full histories of five zones fetched one day per request).
2. Tests first; Red on base (missing modules, old parser codes, scraper URL present).
3. Implement R1–R6; Green under `TZ=UTC`, `Asia/Seoul`, `America/Los_Angeles`.
4. Regression: `test:offline`, `rss-response-smoke.js`, `gather-code-drift`.
5. Smoke with Docker Mongo; client/www E2E (bower libs and compiled CSS in `/tmp/tw-2609-client`, no repository change).
6. Live collector run against real API into a disposable local Mongo (AC11).
7. Docs + Archify regenerate/validate/visual check.
8. Independent verification (fresh-context verifier); commit, push, PR, CI; merge-ready receipt.

## Commands

```sh
npm install --prefix /tmp/tw-2609 --ignore-scripts --no-audit --no-fund async@2.5.0 express@4.13.4 sprintf@0.1.5 xml2js@0.4.23 mongoose@5.1.2 mocha@2.5.3 request@2.88.2 i18n@0.8.3 playwright@1.63.0 sass@1.32.13
TZ=UTC NODE_PATH=/tmp/tw-2609/node_modules node server/test/offline/kma-warning.test.js
NODE_PATH=/tmp/tw-2609/node_modules npm --prefix server run test:offline
docker run -d --rm --name tw2609-mongo -p 27099:27017 mongo:3.4.15
TW_MONGO_URL=mongodb://127.0.0.1:27099/tw2609 NODE_PATH=/tmp/tw-2609/node_modules node server/test/offline/kma-warning-smoke.js
NODE_PATH=/tmp/tw-2609/node_modules node server/test/offline/kma-warning-client-e2e.js
```

## Blast radius and rollback

Warning collection on the scrape host, `/kma/special`, and the summary text of every v000903 KMA response (town warnings). New Mongo collection `kmaspecialweatherzones`; existing documents stay readable. Rollback: revert the commit; the new collection can be dropped.

## Risk review

- Could break: v000903 KMA responses if `getSpecialInfo` throws (it reports errors through the callback and the stage continues, as today); `/kma/special` 501 if a type is missing (types 1–4 are all produced by the API; old documents remain as fallback).
- Riskiest part: event replay correctness (phantom or missing warnings). Proof: replay of 60 recorded days matches `t6`, unit sequences, live run comparison.
- Rejected alternative: full-window rebuild on each change (spec).
- Gate: PROCEED within pre-merge authority. Other-provider review skipped by AK.
