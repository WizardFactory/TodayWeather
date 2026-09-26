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

`test:offline` explicitly selects the offline regression files and gather functional smoke, and propagates failures. `gather-policy.test.js` (#2588) checks that `config/gather.js` defaults equal the former literals and that the production values reach the manager retry/delay/task-flag paths, `PastConditionGather` and the KAQ minimum. The default `npm test` remains the legacy suite. The dedicated [GitHub Actions workflow](../../../.github/workflows/gather-offline.yml) runs this command with Node 22.22.2 and isolated dependencies on relevant pull requests and master pushes, with read-only repository permissions and no deployment steps. The historical Travis job is unchanged.

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

See [daily contract and deployment checklist](../../../reports/sdlc/issue-2560/daily-forecast-contract.md).

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
See the [operator contract](../../../reports/sdlc/issue-2564/operator-contract.md).

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
- Request the production ranges (`yesterday/next7days`, `today/next7days`) with `unitGroup=us&include=days,hours,current` and the `elements` list from `lib/VC/vcRequester.js`.
- Check that the key string does not appear in the files.
- Update `CAPTURED` in `vc-weather.test.js`, the smoke's default instant, and the "valid window" note above.

All four run in the RSS offline workflow. The workflow runs on Node 16 and 22 under UTC and Asia/Seoul, plus separate Node 10.15.3 and mongod jobs.
