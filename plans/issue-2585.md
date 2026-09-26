# Plan: Overseas weather on Visual Crossing instead of Dark Sky — issue 2585

Revision 1, 2026-09-26. Consumes [intent](../intent/issue-2585.md) r1, [spec](../specs/issue-2585.md) r1 and the design report (world-cache sequence). Owner: main agent (builder). Branch `fix/2585-visual-crossing` from `master` `8ae05030`, pushed to the `ak-ongyeol/TodayWeather` fork, PR to `WizardFactory/TodayWeather` `master`.

## File operations

| File | Change | Req |
| --- | --- | --- |
| `server/lib/VC/vcRequester.js` (new) | Timeline requester | R1 |
| `server/lib/VC/vcConverter.js` (new) | Visual Crossing → Dark Sky-format documents, summary vocabulary | R2, R3 |
| `server/models/worldWeather/vc.fetch.lock.model.js` (new) | Lock model with TTL | R5 |
| `server/controllers/worldWeather/dsf.controller.js` | Visual Crossing fetch, lock, yesterday classification, no Google time zone | R4, R5 |
| `server/controllers/worldWeather/controllerWorldWeather.js` | `source`/`pubDate` → `VC` | R6 |
| `server/controllers/controllerPush.js`, `alert.push.controller.js`, `models/modelPush.js`, `models/alert.push.model.js`, `routes/v000803/route.geo.js` | Accept `VC` | R7, R8 |
| `server/lib/DSF/dsfRequester.js`, `server/config/config.js`, `server/.env.example` | Fail-fast legacy requester, `VC_SECRET_KEY` | R8 |
| `client/www/js/service.weatherutil.js`, 3 templates; `tw.ios` (`service.weatherutil.js`, `controller.forecastctrl.js`, 2 templates); `ta.ios` (`service.weatherutil.js`, 2 templates) | `VC` detection, attribution | R9 |
| `packages/weather-core/src/index.ts` + tests; `web/src/{state.ts,Weather.tsx,App.tsx,demo/weather.json}` + tests, `web/e2e/docs-gap.spec.ts` | `VC` source, attribution | R10 |
| `server/test/offline/vc-weather.test.js`, `vc-weather-smoke.js` (new), `fixtures/vc-*.json` (new, recorded 2026-09-26 07:04 UTC), `run.js`, `README.md`, `.github/workflows/rss-offline.yml` | Tests and CI | AC8 |
| Docs (`weather-collection.md`, `mobile-api.md`, `web-client.md`, `docs/rewrite/{external-providers,configuration-inventory,server-response-assembly}.md`), `docs/webapp/diagrams/webapp-implementation.{json,html}` | Provider description | R11 |

Boundaries: route paths `/dsf/coord`, the `DsfForecast` schema, the response shape apart from `source`/`pubDate`, the WAQI branch, the native widget code and bundled vendor code stay unchanged.

## Order

1. Tests first:
   - Write `vc-weather.test.js` and `vc-weather-smoke.js` with fixtures.
   - Red on base: the missing modules, the Dark Sky URL, `source` `DSF` and the missing lock all fail.
2. Server: requester, converter, lock model, controller, response source, push, legacy, config. Green on the unit tests and the smoke.
3. Clients and web; update and run the web/core tests.
4. Docs and the webapp diagram; Archify regeneration.
5. Regression on Node 22.22.2 and 16.20.2:
   - `test:offline` and the existing smokes.
   - Live smoke with `TW_VC_LIVE=1`, 3 locations, about 75 records plus 3 on a repeat.
6. Independent verification in a fresh context, then commit, push, PR, CI and the issue comment.

## Commands

```sh
npm install --prefix /tmp/tw-2585 --ignore-scripts --no-audit --no-fund --package-lock=false async@2.5.0 express@4.13.4 sprintf@0.1.5 xml2js@0.4.23 mongoose@5.1.2 mocha@2.5.3 dotenv@10.0.0 request@2.88.2
TZ=UTC NODE_PATH=/tmp/tw-2585/node_modules node server/test/offline/vc-weather.test.js
TZ=UTC NODE_PATH=/tmp/tw-2585/node_modules node server/test/offline/vc-weather-smoke.js
TZ=UTC NODE_PATH=/tmp/tw-2585/node_modules TW_VC_LIVE=1 node server/test/offline/vc-weather-smoke.js
NODE_PATH=/tmp/tw-2585/node_modules npm --prefix server run test:offline
npm ci && npm test && npm run typecheck   # repository root: weather-core + web
```

## Migration, rollback, blast radius

- **Blast radius:** every overseas response (apps, widgets, web, push) and a new Mongo collection. Korean (KMA) paths are untouched.
- **Rollback:** revert the commit. No data migration; the old Dark Sky path would fail again.
- **Deployment (human-owned):** set `VC_SECRET_KEY` on the service host, deploy the server, then ship the apps and web.

## Risk review

- **What could break:**
  - The weather text differs from before.
  - A released app shows no attribution.
  - The lock blocks a location if release fails; the 10 s TTL and takeover bound it.
- **Riskiest part:** Visual Crossing to Dark Sky semantics (units, fractions, day assignment across time zones). Proof: live-recorded fixtures for three time zones (UTC+9, UTC+1, UTC−4), route smoke through the real merge code, and a live smoke.
- **Rejected alternative:** rewriting the merge/response code for Visual Crossing natively. Larger change, deferred to Phase 2.
- **Gate:** PROCEED within pre-merge authority. Other-provider review skipped by AK.
