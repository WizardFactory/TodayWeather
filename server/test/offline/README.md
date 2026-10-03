# Isolated weather checks

## Gather reconciliation tests

All provider fixtures are synthetic. These tests load real exported functions with explicit VM dependency injection before evaluation. HTTP, DNS initialization, logging, model methods and timers cannot access production; undeclared dependencies/timers fail immediately. No `app.js`, configuration file, `/gather/*` route or Mongo initialization is loaded.

Use an isolated harness instead of installing the whole legacy application:

```sh
npm install --prefix /tmp/issue-2555-harness --ignore-scripts --no-audit --no-fund --package-lock=false mocha@2.5.3 xml2js@0.4.23 async@2.6.4 mongoose@5.1.2 express@4.13.4 sprintf@0.1.5 dotenv@10.0.0
NODE_PATH=/tmp/issue-2555-harness/node_modules npm --prefix server run test:offline
```

Commands run from the repository root; dependency installation needs package-registry access, but test execution needs no network. Tested with Node v22.22.2/npm 10.9.7. Mocha 2.5.3 is within the repository's legacy range; no application dependency tree changes are made.

The separate smoke integrates real XML parsing, requestData/events and the short storage controller's save/read functions through synthetic HTTP and in-memory model adapters. It verifies timestamps, coordinates, exact values and no write on failure. It is not a live provider/DB/mobile test.

The 24h consumer regression asserts that `adjustShort` no longer splits slot amounts across adjacent records (#2583). See [period contract and full disposition](../../../docs/architecture/gather-source-reconciliation.md).

`test:offline` explicitly selects the offline regression files and gather functional smoke, and propagates failures. `gather-quota.test.js` (#2604) covers the bounded request walk, quota/key stops (HTTP 429/401/403 and codes 22/20/30 in HTTP 200 bodies, also on a continuation page), not-retryable 4xx, the Manager's per-service key rotation, and the retry-pass request bound (a failure on all 2,032 grids sends at most `2,032 + (retry − 1) × 101` requests). The separate `gather-quota-smoke.js` runs the real Manager recursion, collector and `request` library over HTTP against a local fake data.go.kr reached through `HTTP_PROXY` (2,032 grids, two keys; loopback only): `NODE_PATH=<deps>/node_modules node server/test/offline/gather-quota-smoke.js`, where the dependency set above also includes `request`. `gather-policy.test.js` (#2588) checks that `config/gather.js` defaults equal the former literals and that the production values reach the manager retry/delay/task-flag paths, `PastConditionGather` and the KAQ minimum. The default `npm test` remains the legacy suite. The dedicated [GitHub Actions workflow](../../../.github/workflows/gather-offline.yml) runs this command with Node 22.22.2 and isolated dependencies on relevant pull requests and master pushes, with read-only repository permissions and no deployment steps. The historical Travis job is unchanged.

Correction coverage uses distinct values for every sea wave field, nonfinite values in later days, mismatched item counts and raw/once-percent-encoded dummy keys. Pagination (#2590) uses a synthetic 1,016-row short product (84 hours × 12 categories + TMN/TMX, sized like the issue-reported live count): pages 1 and 2 are requested sequentially and merged before the unchanged count check; the smoke stores all 84 hours. Continuation pages with a changed `totalCount`, a wrong row count, a row already seen on an earlier page, a mismatching echoed `pageNo`/`numOfRows`, a provider/HTTP/transport/XML error, or a product over 5 pages fail the grid once, without a stored prefix, and the single warning names the failing `page` and `check`. A first page shorter than 999 rows with a different `totalCount` still fails after one request. Key strings decode URI escapes exactly once and re-encode as a query component; raw plus is preserved, malformed escapes fail, literal percent must be supplied as `%25`.

## Isolated RSS checks

Run from the repository root with Node 16.20.2+ (validated with Node 16.20.2 and Node 22.22.2):

```sh
TZ=UTC node server/test/offline/rss-wind.test.js
TZ=America/Los_Angeles node server/test/offline/rss-wind.test.js
```

The regression suite loads complete production modules in an isolated context. It runs the RSS parser, both actual DB read/projection implementations and the merge middleware. Query results and unused collaborators are substituted; there is no server startup, database connection, provider request or collection timer. It reads production projection lists from `app.js` without executing startup.

The response smoke requires only four dependencies in an isolated temporary directory:

```sh
npm install --prefix /tmp/tw-rss-smoke --ignore-scripts --no-audit --no-fund async@2.5.0 express@4.13.4 sprintf@0.1.5 xml2js@0.4.23
TZ=UTC NODE_PATH=/tmp/tw-rss-smoke/node_modules TW_SMOKE_OUTPUT_DIR=/tmp/tw-rss-smoke node server/test/offline/rss-response-smoke.js
```

It executes the actual v000903 coordinate router in process, complete middleware ordering, synthetic XML parsing, both storage read formats, downstream forecast/observation composition, unit conversion, descriptions and final JSON serialization. The external geocoder, model queries and auxiliary provider boundaries use explicit synthetic data; this is not a live HTTP, Mongo persistence, CDN or mobile test. The smoke does not start `app.js` or its background work.

`TZ=UTC` is required for the existing collector's `calculateTime()` behavior. The regression suite's alternate-TZ run checks publication conversion and service merge behavior; it does not establish collector forecast-date invariance. The known pre-existing non-UTC collector shift is documented in the task report.

### RSS continuous integration

[RSS offline checks](../../../.github/workflows/rss-offline.yml) runs on pushes and pull requests using Node 16.20.2 and 22.22.2 with `TZ=UTC`, matching the server timezone confirmed by the operator. Each runtime runs all 43 RSS regression tests, the historical observation/recovery and runtime compatibility suites, and all 36 response smoke cases (both DB formats, three synthetic grids, newer/equal/older publications and both unit systems). A failure in any command fails the job.

Smoke dependencies and output stay under the runner's temporary directory. This workflow is independent of the legacy Mocha/Travis suite and requires no production credentials, database, provider access or service startup. Hosted runner setup and npm installation require network access; the weather checks themselves use isolated dependencies.


## Forecast precipitation periods (#2583)

`precipitation.test.js` covers the category parser (rain in mm, snow in cm), the collector's amount plus category text and its once-per-batch warning for unparsed values, slot sums and the slot precipitation type in `getShort`, the next-day midnight slot, `adjustShort` without splitting, the shortest-window `pty 3` case, strings, DB 2.0 reads and the DB 1.0 per-field merge with the hourly row limit. It is part of `test:offline` and runs in any timezone.

`precipitation-smoke.js` runs the real v000903 coordinate router with the mixed-period fixture (verification matrix V41): stored hourly `PCP`/`SNO` rows with categories, observed past rows, the shortest window and RSS rows, on DB 1.0 and 2.0, equal and newer RSS publications, and two unit sets. It asserts slot and daily totals, periods, approximation flags, strings and that no stored category text reaches the response.

```sh
TZ=UTC NODE_PATH=/tmp/tw-rss-smoke/node_modules node server/test/offline/precipitation.test.js
TZ=UTC NODE_PATH=/tmp/tw-rss-smoke/node_modules node server/test/offline/precipitation-smoke.js
```

Both use the RSS smoke dependencies above; the [RSS offline workflow](../../../.github/workflows/rss-offline.yml) runs them on Node 16.20.2 and 22.22.2. In the DB 1.0 harness `shortest[]` is empty on the baseline too, so the smoke checks `shortest[]` fields on DB 2.0 only.

## Daily forecasts (#2560)

`daily-forecast.test.js` runs the captured day-4–10 regression plus synthetic
parser/storage/service/freshness/RSS cases. The only captured input is
`fixtures/mid-land-captured.json`. `daily-harness.js` uses actual Mongoose schemas
with in-memory persistence adapters and a fixed clock; no Mongo connection.

Install an isolated test environment (no repository dependency changes):

```sh
npm install --prefix /tmp/issue-2560-offline --ignore-scripts --no-audit --no-fund async@2.6.4 xml2js@0.4.23 mocha@2.5.3 express@4.13.4 sprintf@0.1.5 mongoose@5.1.2 dotenv@10.0.0
NODE_PATH=/tmp/issue-2560-offline/node_modules npm --prefix server run test:offline
TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/daily-response-smoke.js
```

The additional smoke executes all v000903 middleware for both DB versions and
C/F units, covering captured, stale, missing-text and missing-temperature data,
plus stale/missing primary short with fresh RSS, partial/nonmatching RSS and
nonzero six-hour precipitation (68 route scenarios). `short-rss-daily.test.js`
adds 44 synthetic source-provenance, freshness, bound and precedence checks
to `test:offline` (223 regression checks plus gather smoke in total).
HTTP, DB and timers are intercepted before loading real modules. It does not
import or initialize `server/app.js`; existing global field declarations are
read as text only. These tests also pass on Node 16.20.2 after replacing the response smoke's
`structuredClone` helper with a Date-preserving V8 clone. Real provider and
deployment behavior remain operator checks.

See [daily contract and deployment checklist](../../../docs/operations/daily-forecast.md).

`daily-review.test.js` adds shower mapping/storage, forecast-gap health, retired scheduler, raw short source publication bounds, DB1 complete snapshot replacement, KST year/midnight and shared JS consumer compatibility checks. Full-route smoke covers D+3 available, absent, partial, stale and DB1 legacy-without-snapshot, showers and optional RSS humidity. Raw additional daily fields do not expand the hourly template or invent daily precipitation totals. Native runtime tests remain operator-owned.

## Environment startup (#2563)

`env-startup.test.js` adds 12 checks using real dotenv 10.0.0 and temporary
server layouts. It verifies loading before the first Express import for direct
app imports, `bin/www`, and `npm start`; working-directory independence; existing
process values including empty strings; missing files; documented dotenv syntax;
and sanitized read failures. It intercepts Express before any application
provider, database, timer or listener can initialize. The operator's actual
`server/.env` is never read by these regression checks.

```sh
NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/env-startup.test.js
```

See [server configuration](../../CONFIGURATION.md) for runtime behavior.

## Paseo workspace environment setup

Run `python3 server/test/offline/paseo-env-setup.test.py` from the repository root.
The synthetic filesystem checks cover environment copying, private permissions,
Git exclusion through existing rules or `info/exclude` with a clean `git status`,
refusal when the file cannot be ignored, existing-file preservation, missing
sources and symlink handling. They also check that the existing AWS-file setup
is preserved. No private
configuration or running Paseo daemon is required.

## Historical observations (#2564)

`history-observations.test.js` and `history-recovery.test.js` run in `test:offline`.
They cover strict KST identities, QC/missing-value validation, sparse history,
independent daily observations, partial-field preservation, explicit past gaps,
pagination, missing-only recovery and duplicate/lease behavior with synthetic data.
Run the observation suite under `TZ=UTC` and `TZ=America/Los_Angeles`.

The history integration job in [Gather offline regression](../../../.github/workflows/gather-offline.yml)
runs the real local persistence/response smoke and non-KST policy checks on
Node 16.20.2 and 22.22.2 for relevant pull requests and master pushes.

For a separate real persistence/transport smoke, install temporary dependencies:

```sh
npm install --prefix /tmp/issue-2564-integration --ignore-scripts --no-audit --no-fund --package-lock=false mongodb-memory-server-core@10.1.4 mongoose@5.1.2
TZ=UTC NODE_PATH=/tmp/issue-2564-integration/node_modules:/tmp/issue-2560-offline/node_modules MONGOMS_DOWNLOAD_DIR=/tmp/issue-2564-mongodb node server/test/offline/history-integration-smoke.js
```

The earlier daily-suite dependency directory supplies Express/async/XML helpers.
The smoke downloads MongoDB 7.0.14 to the specified temporary directory if absent,
starts MongoDB and a synthetic provider only on loopback, and closes both. It uses
the production native collection adapter with the temporary server's modern driver;
the deployed Mongoose 5/old Mongo server combination is not validated by this check.
It verifies real storage/readback/uniqueness/leases, actual HTTP pagination/retries,
and actual v000903 route/shared client parsing in 16 DB-version/unit/data-availability
scenarios. No application startup, production secrets, KMA requests or mobile build.
See the [operator contract](../../../docs/operations/historical-observations.md).

## Air provider chain and domestic air fallback (#2622, #2628)

`air-chain.test.js` (in `test:offline` and the RSS workflow) loads the real policy config, the four adapters, the
shared budgets and the chain in VMs (`air-harness.js`: relative requires resolved from disk, axios and Mongo models
injected). It covers: config defaults/validation; each adapter's request and unit mapping from
`fixtures/air/*.json` (Google ppb → ppm, OpenWeather/Visual Crossing µg/m³ → ppm, WAQI sub-index → concentration);
failure classification (timeout, transport, 401/403 → auth, 429 → quota, malformed bodies) with the key never in
logs or reasons; `evaluate` (8 h, 30 km for stations only, PM required); budgets (monthly cap with 5 % reserve,
OpenWeather minute cap, down markers, paid phase off by default, per-provider paid cap, Visual Crossing on the
overseas day budget, free store errors not blocking, paid reads/reservations failing closed); and the ordering rules (free phase, exhausted phase, paid phase,
skipping unconfigured/down/capped providers, one attempt per provider per request), and the review-round regressions: a
non-string or non-coercible provider status is a classified failure, zero caps block on an empty store, the OpenWeather
rolling minute across the bucket boundary, at most four attempts across phases; paid pre-call reservation, storage failure, no double counting and reservation-month rollover (D20).

`air-fallback.test.js` keeps the #2622 fallback checks against the chain with only WAQI configured: AirKorea-shaped
mapping, limits, no key, failures and their cache periods, cache reuse across module instances, answer after the
cache write, in-flight sharing, malformed bodies, the middleware, `airInfo.source`, the skipped station forecast, the
`getKeco` error path, the route order and the overseas station name.

`air-chain-smoke.js` runs the complete v000903 coordinate and address routes through the response smoke harness with
real `axios` HTTP to one loopback server that plays Google, OpenWeather, Visual Crossing and WAQI: Google answers in
the free phase (DB 1.0/2.0 × `airkorea`/`airnow`), an unchanged fresh AirKorea response, capped Google → OpenWeather,
both capped → WAQI, exhausted budgets with the paid flag off/on, an auth rejection marking Google down for a later
request, a hanging provider bounded by the timeout, every provider failing (cached 2 min), a stale observation moving
on, address = coordinate, and the Jeju WAQI name. `air-budget-mongo-smoke.js` runs worker processes against
one mongod (mongodb-memory-server, mongoose 5.13 as in `vc-lock-mongo-smoke.js`): the OpenWeather minute cap and the
Google month cap are shared across processes, a down marker is seen by another process and expires, a cached
observation serves the next process, both collections have TTL indexes, and concurrent workers compete for a limited paid allowance (D20). `air-chain-node10-check.js` repeats the
adapter, chain, fallback and middleware checks on the host's Node 10.15.3.

```sh
npm install --prefix /tmp/tw-air --ignore-scripts --no-audit --no-fund async@2.5.0 express@4.13.4 sprintf@0.1.5 xml2js@0.4.23 mongoose@5.1.2 i18n@0.8.3 axios@0.18.1
TZ=UTC NODE_PATH=/tmp/tw-air/node_modules node server/test/offline/air-chain.test.js
TZ=UTC NODE_PATH=/tmp/tw-air/node_modules node server/test/offline/air-fallback.test.js
TZ=UTC NODE_PATH=/tmp/tw-air/node_modules node server/test/offline/air-chain-smoke.js
TZ=UTC NODE_PATH=/tmp/tw-air/node_modules node server/test/offline/air-chain-node10-check.js
npm install --prefix /tmp/tw-air-mongo --ignore-scripts --no-audit --no-fund mongoose@5.13.22 async@2.5.0 mongodb-memory-server-core@10.1.4 axios@0.18.1
TZ=UTC NODE_PATH=/tmp/tw-air-mongo/node_modules node server/test/offline/air-budget-mongo-smoke.js
```

No check calls a real provider or a production database. `fixtures/waqi-*.json` and `fixtures/air/visualcrossing-seoul.json`
are read-only captures from 2026-09-27 without keys; `fixtures/air/google-seoul.json` and `openweather-seoul.json` are
reconstructed from the vendors' documentation (the Google API was not enabled and the OpenWeather key was rejected when
they were written).

## Node 16 runtime and push compatibility (#2565)

The service target is Node 16.20.2 / npm 8.19.4 (`server/.nvmrc`), an interim
EOL runtime. Use the checked-in lock; broad fresh resolution can select newer
transitive packages that require Node 18 or 20. `npm ci` removes the target
`node_modules`, so install only into a separate candidate, never the live tree.

```sh
# Select Node 16.20.2 first. From the repository root:
mkdir -p /tmp/tw-runtime-candidate
cp server/package.json server/package-lock.json /tmp/tw-runtime-candidate/
npm ci --prefix /tmp/tw-runtime-candidate --no-audit --no-fund
NODE_PATH=/tmp/tw-runtime-candidate/node_modules npm --prefix server run test:runtime
NODE_PATH=/tmp/tw-runtime-candidate/node_modules npm --prefix server run test:runtime:smoke
```

`test:runtime` checks lazy Firebase initialization, app selection, payloads,
callback errors and alarm/alert rejection of legacy iOS records without FCM using explicit VM substitutes. `test:runtime:smoke` requires
OpenSSL and permission to bind loopback sockets. It loads real native grpc/iconv,
requires the retired APNs package to be absent and sends a synthetic FCM request
only to a locally generated TLS peer, checking its encoded payload and response. A separate child loads the full
app in `service`/`test` mode, substitutes Mongo connection, checks `/health` = `OK`
and emits a normal Console log. External network connections are rejected before
SDK or app imports. No real credentials, provider calls, push sends or collection
are used. Each child has a 30-second limit.

The smoke deliberately omits production DB/provider behavior and Amazon Linux 1
linking. OpenSSL must support `req -addext` (1.1.1+); the SDK/native import checks
on the older target host are a separate gate. The existing legacy `npm test` /
`e2e` suites include providers and databases; they are not part of this command.

## Weather text and summary (#2576)

`weather-desc.test.js` (part of `test:offline`; also on the rss-offline Node 16/22 matrix) covers the KMA wording normalization, `getWeatherStr` empty labels, the `updateWeather` sky and PTY 1–7 fallback and both summary builders. `weather-desc-response-smoke.js` reuses the RSS response harness to run the actual v000903 coordinate route for DB 1.0/2.0. The station text scenarios are: observed `비끝`/`약한비연속적`; unmapped text falling back to sky, to pty 1 (`비조금`) and to nowcast pty 5 (`빗방울`); no station text with nowcast pty 5 (the #2573 `hourlyMissing` path); and unmapped text with an invalid sky (`weather ""`). It asserts `current.weather`, `weatherType`, `summary` and `summaryWeather`, and that no programming exception is swallowed. Station text is typed with the real `makeWeatherType`, as `getStnHourlyAndMinRns` does; the station query itself stays synthetic. Run it with the RSS smoke dependencies and `TZ=UTC`:

```sh
TZ=UTC NODE_PATH=/tmp/tw-rss-smoke/node_modules node server/test/offline/weather-desc-response-smoke.js
```

## Current air summary (#2578)

`air-summary.test.js` runs in `test:offline` and the RSS workflow. It loads the
actual summary builders, the world-weather summary middleware and AirKorea merge
code in isolated VMs. It checks that a missing `current.arpltn` yields no air
summary (weather/life-index grades such as `wsdGrade` are never read as air
grades), that the combined `summary` neither reads nor writes air fields on
`current`, that an empty world `summaryAir` is omitted, and that every AirKorea
station is compared with the same eight-hour window from request time.

`air-summary-smoke.js` reuses the response smoke harness to run the complete
v000903 coordinate middleware for both DB versions with missing, empty and fresh
air observations; `summaryAir` must be absent for the first two. Dependencies are the same as the RSS response smoke:

```sh
TZ=UTC NODE_PATH=/tmp/tw-rss-smoke/node_modules node server/test/offline/air-summary-smoke.js
```

These are synthetic checks, not live AirKorea, Mongo or mobile tests. AirKorea
`dataTime` is still parsed in the host timezone; see
[intent](../../../intent/issue-2578.md) for that separate limitation.

## Sunrise/sunset and UV (#2587)

`riseset-uv.test.js` (part of `test:offline`) loads the production modules in a VM with stubbed HTTP, models and configuration. It checks computed sunrise/sunset against KASI reference values under three host time zones, `getRiseSetInfo` fill-in and failure handling, KASI key rotation and per-area continuation, and the `getUVIdxV5` collector: slot fallback, pagination, key rotation, no partial save and conversion into daily `ultrv` read back through `appendData2`. `fixtures/uv-idx-v5.json` is a live `getUVIdxV5` response recorded on 2026-09-26 (`areaNo=` `numOfRows=3` `time=2026092612`; first three of 3,851 areas; the body contains no key).

`life-index-2650.test.js` checks all three pollen species, seasonal dispatch and pagination with isolated dependencies. `fixtures/pollen-risk-v3-live-20261001.json` holds three sanitized rows from the live weeds V3 API on 2026-10-01, including an empty `today`, a valid zero `tomorrow` and no `theDayAfterTomorrow`. The test confirms that the zero lands on 2026-10-01 and missing days are omitted, including under `TZ=America/Los_Angeles`; the first KST day of the April and August seasons is also tested. No credential is stored in the fixture.

`riseset-uv-smoke.js` runs the v000903 coordinate route through the RSS smoke harness with the real KASI and life index controllers on synthetic store rows (DB 1.0 and 2.0; stores present, empty and failing):

```sh
npm install --prefix /tmp/tw-2587 --ignore-scripts --no-audit --no-fund async@2.5.0 express@4.13.4 sprintf@0.1.5 xml2js@0.4.23 mongoose@5.1.2 mocha@2.5.3 cheerio@^0.20.0
TZ=UTC NODE_PATH=/tmp/tw-2587/node_modules node server/test/offline/riseset-uv.test.js
TZ=UTC NODE_PATH=/tmp/tw-2587/node_modules node server/test/offline/riseset-uv-smoke.js
```

Both run in the RSS offline workflow. Deployment to the gather host and the deployed response remain operator checks.

## Overseas weather on Visual Crossing (#2585)

| File | What it covers |
| --- | --- |
| `vc-weather.test.js` | Unit tests; also run by `test:offline`. The real requester, converter and `DsfController` are loaded in a VM with a fake `https` and in-memory models. Covers: request shape and gzip; timeout budget; 429 handling (concurrency vs daily limit); key scrubbing; the conversion to Dark Sky format; the summary vocabulary; DST and half-hour zones; single-flight lock, takeover, backoff and failed flag; stale fallback; provider-down marker; daily budget; usage counter; push paths; retired Dark Sky; app and template checks. |
| `vc-weather-smoke.js` | Runs the real v000903/v000901 and `/ww` routers with full middleware. **Fixture mode (default):** recorded responses for Tokyo, London and New York at a fixed clock, 2026-09-26 07:04:30 UTC. The fixtures cover about 04:05–14:49 UTC that day; other `TW_SMOKE_NOW` values fail. It also runs synthetic `vc-synthetic.js` scenarios with stored-record sequences: London, Auckland and New York DST changes; +5:30, +5:45, +14, −11 and −2:30 zones; calm and clear days; missing fields; polar days; no `currentConditions`; precipitation types. It checks exact unit conversions, the three apps' parsers and the push/alert consumers. **Live mode** (`TW_VC_LIVE=1`) uses the real requester and `VC_SECRET_KEY` from the environment or `server/.env`. It costs about 76 records per run. Synthetic scenarios also cover a stale fallback through the routers. CI's `vc-node10` job also runs this smoke on Node 10.15.3. |
| `vc-lock-mongo-smoke.js` | Real models and controller on a real mongod (mongodb-memory-server, or `TW_MONGO_URL`). Covers the TTL index, single flight, geo casting, bounded reads, takeover, the failed flag, owner-token release, backoff, the provider marker, stale fallback and the usage counter. It uses mongoose 5.13, because the service's 5.1.2 driver cannot connect to mongod ≥ 5.1. |
| `vc-node10-check.js` | Plain Node 10.15.3 script (the service host's runtime): requester with gzip, converter, and the controller flow including `Intl` zone offsets, with stale (`Asia/Almaty`), renamed (`Europe/Kyiv`) and unknown zones falling back to the stored offset. The world merge and route middleware are covered on Node 16/22 by the smoke, not here. It fails on exit unless every step ran; the smoke also has a 10-second per-request timeout and the same completion guard. |

```sh
npm install --prefix /tmp/tw-2585 --ignore-scripts --no-audit --no-fund --package-lock=false async@2.5.0 express@4.13.4 sprintf@0.1.5 xml2js@0.4.23 mongoose@5.1.2 i18n@0.8.3
TZ=UTC NODE_PATH=/tmp/tw-2585/node_modules node server/test/offline/vc-weather.test.js
TZ=UTC NODE_PATH=/tmp/tw-2585/node_modules node server/test/offline/vc-weather-smoke.js
TZ=UTC NODE_PATH=/tmp/tw-2585/node_modules TW_VC_LIVE=1 node server/test/offline/vc-weather-smoke.js   # live, costs records
npm install --prefix /tmp/tw-2585-mongo --ignore-scripts --no-audit --no-fund --package-lock=false mongoose@5.13.22 async@2.5.0 mongodb-memory-server-core@10.1.4
TZ=UTC NODE_PATH=/tmp/tw-2585-mongo/node_modules node server/test/offline/vc-lock-mongo-smoke.js
```

**Re-recording fixtures**
- Request the recorded ranges (`yesterday/next7days`, `today/next7days`); tests derive range `combined` (`last1days/next7days`) by prepending a cooler, dry copy of the recorded yesterday (`withDayBefore` in `vc-synthetic.js`) with `unitGroup=us&include=days,hours,current` and the `elements` list from `lib/VC/vcRequester.js`.
- Check that the key string does not appear in the files.
- Update `CAPTURED` in `vc-weather.test.js`, the smoke's default instant, and the "valid window" note above.

All four run in the RSS offline workflow. The workflow runs on Node 16 and 22 under UTC and Asia/Seoul, plus separate Node 10.15.3 and mongod jobs.

## Gateway routes (#2606)

`gateway-geocoder.test.js`, `gateway-route.test.js` and `gateway-callers.test.js` cover the public `/weather` and `/geocode` routes that replace the tw-backend-functions Lambdas (scenarios U, RT and IC in [the test scenarios](../../../specs/issue-2606-test-scenarios.md)). All three are part of `test:offline`. Besides the gather dependencies above, the route test needs `cors` and `express-session`:

```sh
npm install --prefix /tmp/issue-2606-harness --ignore-scripts --no-audit --no-fund --package-lock=false mocha@2.5.3 cheerio@0.20.0 xml2js@0.4.23 async@2.6.4 mongoose@5.1.2 sprintf@0.1.5 express@4.13.4 iconv-lite@0.4.24 dotenv@10.0.0 cors@2.8.5 express-session@1.15.6
NODE_PATH=/tmp/issue-2606-harness/node_modules npm --prefix server run test:offline
```

The provider responses in `fixtures/gateway/providers.json` are synthetic and follow the real Kakao and Google response structures. `fixtures/gateway/goldens.json` is the output of the tw-backend-functions `a4c1deb` modules (geoinfo and weather, identical to the production handlers at `1b489a9`) on those fixtures and on the per-version backend samples in `backend.json`. It covers 19 coordinate cases, 3 address cases and 132 weather requests (versions × client queries × `Accept-Language` forms). Regenerate it with `fixtures/gateway/make-goldens.js` (the command is in its header). The Kakao address fallback case has no golden, because the Lambda crashes on it; the port's intended output is recorded in `cases.json`.

The route test composes the app in `app.js` order (`cors()` → gateway → `express-session` → a stub backend) and reaches the stub over 127.0.0.1. `gateway-local-smoke.js` runs the real `bin/www` with mongod and stub providers in a loopback-only network namespace (scenario LD-1). It needs the full server dependency install, so it is not part of `test:offline`.

## KMA warning checks (#2609)

`kma-warning.test.js` (part of `test:offline` and the RSS offline workflow) loads the WthrWrnInfoService requester, collector, zone replay/mapping, model parsers and the special weather controller in isolated VMs with live responses recorded on 2026-09-27 (`fixtures/kma-warning/`, no keys). It covers key encoding and rotation, error classes (codes 30, 22, 99, NODATA), paging without `totalCount`, event replay (per-type releases over day-by-day rows), change-driven calls with retries while an operation lags, the hourly resync, town-to-zone mapping and `/kma/special` output under any host time zone:

```sh
TZ=UTC NODE_PATH=/tmp/tw-rss-smoke/node_modules node server/test/offline/kma-warning.test.js
```

`kma-warning-node10-check.js` runs one collection cycle and both readers with the real modules on the service host's Node 10.15.3 (CI job `vc-node10`).

`kma-warning-smoke.js` needs a disposable local MongoDB (its database is dropped). It runs the real requester over HTTP against a local provider stub, the real collector and models, the real `/v000903/kma` router with i18n, and the v000903 town response from the rss-response-smoke harness with the real special weather controller reading the stored zone state. Beyond the RSS smoke dependencies it needs `mongoose@5.1.2 request i18n@0.8.3` and the route's `axios get-pixels aws-sdk dnscache`:

```sh
docker run -d --rm --name tw2609-mongo -p 127.0.0.1:27099:27017 mongo:3.4.15
TZ=UTC TW_MONGO_URL=mongodb://127.0.0.1:27099/tw2609 NODE_PATH=<deps> node server/test/offline/kma-warning-smoke.js
```

`kma-warning-client-e2e.js` starts that smoke in server mode, serves `client/www` from the same origin (a `cordova.js` stub emits `deviceready`) and checks in Chromium (`ko-KR`, `Asia/Seoul`) that the forecast summary shows the town warning and that S12 (`#/kma-special`) lists every bulletin type. `client/www` has no bower libraries or compiled CSS in the repository; prepare them outside the checkout:

```sh
(cd /tmp/tw-client && cp <repo>/client/bower.json . && echo '{"directory":"lib"}' > .bowerrc && npx bower@1.8.14 install --allow-root)
mkdir -p /tmp/tw-client/www && ln -s /tmp/tw-client/lib /tmp/tw-client/www/lib
npx sass@1.32.13 --no-source-map --load-path=/tmp/tw-client client/scss/ionic.app.scss /tmp/tw-client/css/ionic.app.css
TZ=UTC TW_MONGO_URL=mongodb://127.0.0.1:27099/tw2609 TW_CLIENT_LIB=/tmp/tw-client/lib TW_CLIENT_CSS=/tmp/tw-client/css/ionic.app.css \
  PLAYWRIGHT_EXECUTABLE_PATH=<chromium> NODE_PATH=<deps + playwright> node server/test/offline/kma-warning-client-e2e.js
```

jQuery (`lib/jquery/dist`) is not in `bower.json`; copy it from the `jquery@3.3.1` npm package. Screenshots and results go to `TW_SMOKE_OUTPUT_DIR`.

## Push store (#2626)

`push-store.test.js` (in `test:offline`) runs the real push routers and controllers with `PUSH_STORE=sqlite` on a temporary file. It covers push-list upserts, token changes on every record (including collisions), `DELETE` of city 0, 403 for an unknown category, alarm and alert selection, the 6-hour alert guard, a corrupt file, another `user_version`, and the Mongo store's query shapes with fake models. `push-store-concurrency.js` starts 10 writer processes (200 records), checks that a waiting writer keeps its event loop free, recovers a dead owner's lock and two waiters on it, and opens the file with Python `sqlite3` when available. Both need `sql.js@1.8.0 body-parser@1.13.3` besides the RSS smoke dependencies and run on Node 10.15.3, 16.20.2 and 22.

`push-worker-smoke.js` needs the locked service dependencies (`npm ci` of `server/package-lock.json`). It sends alarms and alerts through the real controllers from the SQLite store, with weather from a loopback stub serving `fixtures/push-kma-weather.json` (the RSS response smoke's v000903 KMA response with rain in `current`) and FCM replaced. It then starts `bin/push-worker` and fails on any listener, MongoDB connection or non-loopback socket.

```sh
NODE_PATH=/tmp/tw-rss-smoke/node_modules node server/test/offline/push-store.test.js
NODE_PATH=/tmp/tw-rss-smoke/node_modules node server/test/offline/push-store-concurrency.js
NODE_PATH=/tmp/tw-runtime-candidate/node_modules node server/test/offline/push-worker-smoke.js
```

These are local checks; FCM delivery to devices and the tw-svc deployment are operator checks in #2626.

## S3 push coordinator (#2626 revision 2)

- `node server/test/offline/push-s3.test.js`: dependency-free contract/race tests;
  also in `test:offline` and RSS CI.
- `NODE_PATH=<locked-deps> node server/test/offline/push-s3-smoke.js`: real routes,
  Unix IPC, AWS SDK with loopback S3 peer and direct HTTP v1 sender with a loopback
  FCM peer, including Retry-After. No actual AWS/FCM calls.
- `NODE_PATH=<locked-deps> node server/test/offline/push-s3-runtime-smoke.js`: actual
  geocode/weather HTTP and legacy formatters, synthetic OAuth, nonlocal sockets refused.
- `node server/test/offline/push-s3-capacity.js`: 10k warning targets behind 100k normal
  queued jobs, 200ms synthetic transport and 3ms synthetic S3 PUT; 30s provisional goal.
- `node server/test/offline/push-burst-benchmark.js`: isolated dispatcher profile at
  256 slots/1k attempts/s; not production or device-receipt evidence.

The new integrated smokes/capacity check run in the Node 16.20.2 `push-worker` CI job;
existing SQLite checks remain. S3 activation/rollback prerequisites are in
[the runbook](../../../docs/operations/push-s3.md).

### Existing TodayWeather client registration (#2626)

`TZ=UTC node server/test/offline/push-s3-smoke.js --client` (also run with
`TZ=Asia/Seoul`) executes the unchanged `client/www/js/service.push.js` factory.
The Angular factory registration, native services and startup timer are adapted;
HTTP requests use the real routers, Unix IPC, coordinator and AWS SDK with local
S3/FCM protocol peers. It covers registration, reopening, location change, token
rotation, persistence failure, restore, deletion, alarm settings and disable.
This is client-code integration coverage, not a native-app/UI or device receipt test.


## Overseas request-time air (#2628 PR 2)

`world-air.test.js` (registered in `run.js`) exercises the real shared-service callback and world query/merge/unit/summary code with injected dependencies: concentration-based grading, provider source, regional observation time, no copied yesterday air and nonfatal air failure. It preserves a legacy WAQI merge regression. Run it under UTC, Asia/Seoul and America/St_Johns to catch host-timezone assumptions.

`world-air-smoke.js` drives the real DSF v000901/v000902/v000903 and widget middleware through the Visual Crossing weather fixture harness, with actual axios HTTP to a loopback server for all four air providers. It checks requested airUnit/source/time/concentrations and client-visible summaries, shared cache reuse, free-cap fallback, the paid Visual Crossing path (reservation and shared weather record usage), weather-cache hits with an expired air failure cache, no-key/all-failure/timeout behavior and current-only air. Synthetic keys only; no live provider calls. Servers are closed after the run; `TW_SMOKE_OUTPUT_DIR` selects evidence output. This smoke also runs on Node 10.15.3.

```sh
NODE_PATH=/tmp/tw-2622/node_modules node server/test/offline/world-air.test.js
TZ=UTC NODE_PATH=/tmp/tw-2622/node_modules node server/test/offline/world-air-smoke.js
```

Existing `vc-weather-smoke.js` remains weather-focused and stubs the optional shared air service by default. Its opt-in harness injection supports the air smoke without changing weather fixture behavior. Domestic air tests, budget/Mongo smoke and D20 reservation tests remain separate regression coverage. No new cache collection, provider quota or deployment is introduced.

PR2631 D22 regressions cover the whole overseas optional-air deadline, late success/cache reuse without duplicate callbacks or paid accounting, and additive source/attribution in DSF and raw widget responses. Tests use synthetic provider metadata and local HTTP; client attribution rendering and licensing approval are not tested.

D23 also verifies the request-local pending/3-second advisory hint on deadline responses, no hint on completed success/failure, and disappearance after late cache fill; no automatic client retry is exercised or implemented.

## Exact-hour station fallback (#2648)

`historical-fallback.test.js` covers invalid temperatures, exact yesterday selection, legacy BSON KST keys, field preservation, temperature provenance, live station replacement, Fahrenheit eligibility and late callbacks after the 250 ms fallback budget. `history-read-cache.test.js` covers coalesced reads, late cache warming, failure caching, timeout and capacity. Both are included in `run.js`.

`TZ=UTC node server/test/offline/history-integration-smoke.js` uses temporary MongoDB and loopback HTTP to exercise recovery/readback plus real v000903 middleware and client parsers for both DB formats and temperature units. Its dependencies and MongoDB binary must already be provisioned in an isolated environment; it never calls the live provider. Current verification and limitations are recorded in [selected evidence](../../../docs/evidence/tasks/issue-2648/verification.md).

## Station query compatibility (#2648)

The pinned `mongoose@5.1.2` supports `Query.setOptions({maxTimeMS: 2000})`,
not `Query.maxTimeMS()`. Native MongoDB cursors in the ASOS history store retain
`cursor.maxTimeMS()`. These commands use the exact pinned package, real schemas
and Query construction/chaining; only `exec` persistence returns fixture rows.
A version mismatch fails rather than testing a newer Mongoose accidentally.

```sh
TZ=UTC NODE_PATH=/tmp/issue-2564-master-ci-deps/node_modules node server/test/offline/kma-query-compat.test.js
TZ=UTC NODE_PATH=/tmp/issue-2564-master-ci-deps/node_modules node server/test/offline/kma-query-route-smoke.js
```

Use an isolated dependency directory containing the RSS smoke dependencies above,
including `mongoose@5.1.2`. The separate smoke sends real loopback HTTP requests
through the v000903 address router and real historical station controller/query
paths for both DB formats. It asserts the observed temperature and station
provenance, plus degraded station-storage failures. It does not connect to MongoDB
or production, test server-side timeout enforcement, or establish production recovery.
CI runs both commands on Node 16.20.2 and 22.22.2.

## Unified data.go.kr keys (#2618)

`data-go-kr-keys.test.js` covers list parsing, ignored legacy fields, sanitized
startup warnings and UV/pollen/KASI/warning/forecast-zone auth/quota rotation,
exhaustion, empty lists and non-key errors. It is selected by `test:offline`.
`data-go-kr-keys-smoke.js` uses the real `request` library over loopback HTTP
(20 requests) to check exact key encoding, provider XML quota errors, response
contracts and bounded success/exhaustion. Run it separately with `request` and
`async` in the isolated dependencies. Existing `gather-quota-smoke.js` verifies
Manager/collector cycles on 2,032 grids plus mounted current/shortest/short/past entrypoint success and exhaustion (16 additional HTTP requests). Review regressions
also cover DB errors concurrent with quota rejection, empty/resultless callback
paths, bounded past dispatch and successful-key reuse across coordinates. The
HTTP smoke checks multi-time rotation with two in-flight slots, seven writes per
coordinate, no repeated successful time, and DB-error priority. These are synthetic integrations; live
gather acceptance belongs to the [operator runbook](../../../docs/operations/data-go-kr-keys.md).

## Food-poisoning forecast recovery (#2600)

`food-poisoning.test.js` uses a recorded MFDS response and isolated collaborators to verify grades, KST dates, regional matching, bounded schedules and optional-read failures. `food-poisoning-route.test.js` executes the actual Express coordinate middleware for both domestic DB versions, with provider/model boundaries isolated. These are included in `test:offline`; run it with `TZ=UTC` for the date-bound route harness.

The recorded [MFDS fixture](fixtures/mfds-risk-20261003.json) was fetched once on 2026-10-03 UTC from `https://poisonmap.mfds.go.kr/api/risk.do` with the TodayWeather User-Agent. It contains 267 rows, `baseDate=20260929` and `regDatetime=2026-09-291700`. Raw data is retained unchanged. Route/smoke scenarios explicitly shift publication/date metadata to the fixed weather calendar; their values are recorded, but their dates are synthetic. This is not current live forecast evidence.

The distinct `food-poisoning-smoke.js` uses loopback HTTP and a disposable real MongoDB to verify storage/readback, conditional publication upserts and production Express response fields. It creates no application collectors. With isolated `mongoose@5.13`, `mongodb-memory-server-core`, `express`, `async`, `xml2js` and `sprintf`:

```sh
TZ=UTC NODE_PATH=/tmp/food-poisoning-deps/node_modules node server/test/offline/food-poisoning-smoke.js
```

`MONGOMS_SYSTEM_BINARY` may select an existing local mongod. Mongoose 5.1.2 schema/query casting is checked separately; its old driver requires MongoDB <=5.0, whereas this real-database smoke uses Mongoose 5.13 with a modern mongod. TTL index creation is disabled only in the smoke's historical fixture database; read-time expiry is still enforced. See the [operating contract](../../../docs/operations/food-poisoning.md).
