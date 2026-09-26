# Spec: Load geo and push controllers without provider credentials — issue 2589

Revision 1, 2026-09-26. Consumes [intent](../intent/issue-2589.md) r1 and `reports/sdlc/issue-2589/investigation.md`. No source changes at this stage.

## Requirements

| ID | Requirement | AC |
| --- | --- | --- |
| R1 | `geo.controller.js` reads no key list at load. A module-level helper `getKeyList(name)` parses `config.keyString[name]` on first use and caches the result. A value that is absent, not JSON or not an array gives `[]` and one `log.warn` naming the setting (never the value). | AC1, AC2 |
| R2 | `_getAddressFromKakao` with an empty Kakao list calls back with `Error('Kakao API key is not configured (kakao_keys)')`, sends no request and returns `this`. With keys, behavior is unchanged: `async.retry(keys.length, …)`, `Authorization: 'KakaoAK ' + keys[index]`, same URL and result. `_getAddressFromDaum` uses the same helper for `daum_keys` (empty list → same style of error). | AC2, AC3 |
| R3 | Both `_getAddressFromKakao` callbacks in `location2address` return `err` before parsing the result, so `next` receives the Kakao error instead of a `TypeError` from parsing `undefined`. Success paths are unchanged. | AC2 |
| R4 | `controllerPush.js` needs no source change: its only load-time failure is R1 through `controllerTown24h → controllerTown → geo.controller`. Its load without Firebase JSON or APNs files is covered by a real-module check. | AC4 |
| R5 | Tests: a VM regression test in `test:offline` and the RSS workflow for R1–R3; a real-module Node 16.20.2 smoke that loads both controllers (and the service app) with the full locked dependency tree and no keys/credentials, run locally and in CI. | AC5 |

## Interfaces and data

No route, response, storage, `DB_DATA_VERSION`, config default or client contract change. `GeoController` prototype methods and `setGoogleApiKey` keep their signatures. `module.exports` stays the constructor.

## Normal and failure behavior

- Keys configured (JSON array): identical requests and results.
- Keys absent/invalid on a service host: module loads; a Korean `location2address` call ends with `next(Error('Kakao API key is not configured (kakao_keys)'))`; the route's existing error handling applies. One warning per setting per process.
- The parsed list is cached for the process lifetime, matching the previous load-time read (config comes from the environment at start).
- Gather: `kmaScraper` geocoding already falls back to `_convertGeoCodeByApiServer` (#2573) and does not use `GeoController`.

## Security and observability

The warning names the setting and the problem ("missing", "not valid JSON", "not an array"), never the value. No credential appears in tests or logs.

## Compatibility, migration, rollback

No migration. Rollback: revert the commit. A misconfigured service host now fails Korean geocode requests instead of failing at startup; the warning makes the cause visible.

## Verification strategy

- Unit (isolated VM, real `geo.controller.js`, stubbed `axios`/`async`/`config`/`log`): R1 for unset, non-JSON, object and valid lists; R2 error, no request, single warning, header/retry order with keys; R3 `next(err)` for a Korean coordinate. Red on base expected: load throws for unset/non-JSON; object input makes `async.retry(undefined)`.
- Smoke (real modules, Node 16.20.2, master lock via `npm ci`, outbound sockets blocked, Mongo connect stubbed): per scenario in a fresh child process, require `controllerPush`, `alert.push.controller`, `geo.controller` and the service-mode app; check `firebase-admin` has no app, a Kakao call returns the clear error without a socket, `/health` returns `OK`. Red on base expected for missing keys.
- Regression: `test:offline`, `test:runtime`, RSS/air/weather-desc smokes on Node 16.20.2 and 22.22.2; CI.

## Alternatives

- Fix only `kakao_keys` and keep `daum_keys` at load: rejected; same crash class for the same module, one line more.
- Change `config.js` defaults: rejected; the gather host keeps its own edited `config.js`, so the fix must be in the module.
- Fix `startManager`/`_appendFromKeco` too: deferred; not load-time, different blast radius (gather collection). Reported on the issue.

## Risks

Low. The riskiest part is changing the error object in `location2address` (R3); both previous and new paths end in `next(err)`.

## Amendment 1 — 2026-09-26

Source: independent verification (NIT). R1 (revised): the warning is one message per setting, "`<name>` is not set or not a JSON array of keys; requests that need it will fail". It does not name the individual cause. It still never contains the value. The code, tests and ACs are unchanged. Architecture and README notes were corrected: `app.js` still parses `dongnae_forecast_keys` at load, and `startManager()` also parses `airkorea_keys` and `daum_keys`.
