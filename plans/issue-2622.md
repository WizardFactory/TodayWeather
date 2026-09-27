# Plan: WAQI fallback for domestic air and short WAQI station names — issue 2622

Revision 2, 2026-09-27. Consumes [intent](../intent/issue-2622.md) r1b and [spec](../specs/issue-2622.md) r3. r2: Node 10.15.3 check (`waqi-air-node10-check.js`, CI `vc-node10`), Mongo smoke with mongoose 5.13.22 (CI `vc-lock-mongo`), docs `external-providers.md` W4. Owner: main agent (builder, Claude/Anthropic). Branch `fix/2622-waqi-air-fallback` from `master` 65943c6e in worktree `tall-dog`.

## File operations

| File | Change | Req/AC |
| --- | --- | --- |
| `server/lib/AQI/waqiStationName.js` (new) | `shorten(name)` | R5 / AC6 |
| `server/lib/AQI/waqiAirFallback.js` (new) | fetch, accept, map, shared cache, in-flight sharing | R3 / AC1, AC3, AC4 |
| `server/models/waqi.air.cache.model.js` (new) | cache schema, unique `cell`, TTL index | R3 / AC4 |
| `server/controllers/controllerTown.js` | `getKeco` error guard, `req.airGCoord` | R1 / AC3 |
| `server/controllers/controllerTown24h.js` | `getWaqiAirFallback`; `makeAirInfoList` source; `_getAirForecast` skip | R2, R4 / AC1–AC3 |
| `server/routes/v000903/route.kma.v000903.js` | insert `cTown.getWaqiAirFallback` after `getKeco` | R2 / AC1, AC5 |
| `server/controllers/worldWeather/controller.ww.units.js` | shorten `arpltn.stationName` | R5 / AC6 |
| `server/test/offline/waqi-air.test.js` (new), `run.js` | unit tests | AC1–AC4, AC6 |
| `server/test/offline/waqi-air-smoke.js` (new), `rss-response-smoke.js` (harness: cache model stub, optional axios override, addr route) | route smoke, loopback WAQI over real axios | AC1–AC5 |
| `server/test/offline/waqi-cache-mongo-smoke.js` (new) | worker processes + mongodb-memory-server + loopback WAQI | AC4 |
| `server/test/offline/waqi-air-node10-check.js` (new) | host runtime Node 10.15.3 | AC7 |
| `.github/workflows/rss-offline.yml` | run unit test and route smoke; add `axios@0.18.1` | AC7 |
| `docs/architecture/mobile-api.md`, `weather-collection.md`, `docs/rewrite/external-providers.md`, `docs/architecture/README.md`, `server/test/offline/README.md` | fallback, cache, source, station-name rule | AC8 |
| `docs/architecture/diagrams/domestic-air-fallback.json` + delivered `.html` (new) | fallback + shared cache sequence | AC8 |

## Order

1. Tests first: `waqi-air.test.js` (unit), then route smoke; Red on base (missing modules/middleware).
2. R5 → R3 (+ model) → R1 → R2/R4 → route insert → world station name; Green; `test:offline`.
3. Route smoke (loopback WAQI via real axios), Mongo cache smoke, optional live WAQI smoke (read-only).
4. Node 16.20.2 run (downloaded binary) and Node 10.15.3 check (docker).
5. Docs + diagram (Archify validate/deliver/visual-check).
6. Independent verification; commit; push; PR; CI; PR review; corrections; merge-ready receipt.

## Commands

```sh
export NODE_PATH=/tmp/tw-2622/node_modules   # async express sprintf xml2js mongoose i18n axios@0.18.1 mocha
node server/test/offline/waqi-air.test.js
npm --prefix server run test:offline
TZ=UTC node server/test/offline/waqi-air-smoke.js
TZ=UTC node server/test/offline/air-summary-smoke.js && TZ=UTC node server/test/offline/rss-response-smoke.js
NODE_PATH=/tmp/tw-2585-mongo/node_modules:/tmp/tw-2622/node_modules node server/test/offline/waqi-cache-mongo-smoke.js   # mongoose 5.13.22
docker run --rm --network none -e NODE_PATH=/deps -v $PWD:/repo:ro -v /tmp/tw-2622/node_modules:/deps:ro -w /repo node:10.15.3-stretch node server/test/offline/waqi-air-node10-check.js
```

## Risks, blast radius, rollback

- Blast radius: every v000903 KMA response without fresh AirKorea air (adds one Mongo read, at most one WAQI call per town cell per 2–30 min across all workers); overseas `stationName` text for long names.
- Riskiest part: middleware must call `next()` exactly once on every path (timeouts, cache errors, exceptions) — covered by unit tests counting calls and the route smoke.
- Could break: app air tab if the WAQI airInfo shape differs (mitigated by reusing `makeAirInfoList`/`_convertAirInfo`); `AirForecastList` errors (skipped for aqicn).
- Load: WAQI quota unknown; failure TTL prevents hammering during WAQI outages.
- Rollback: revert the commit; the cache collection can be dropped. Disable at runtime by unsetting `WAQI_SECRET_KEY` only if the world path is also acceptable without it (it is shared) — otherwise revert.
- Rejected alternative: `controllerAqi.requestAqiData` (Mongo rows per exact coordinate, TLSv1 `request`, ~18 s retries).
- Proof: unit + route smoke + real-Mongo cache smoke on Node 16/22 and the Node 10.15.3 check, then independent verification and cross-provider PR review.
