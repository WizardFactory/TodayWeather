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

The legacy 24h consumer characterization deliberately exposes its adjacent-record quantity split. Passing means the existing assumption is documented; it does not validate that split for hourly PCP/SNO. See [period limitations and full disposition](../../../docs/architecture/gather-source-reconciliation.md).

`test:offline` explicitly selects the offline regression files and gather functional smoke, and propagates failures. The default `npm test` remains the legacy suite. The dedicated [GitHub Actions workflow](../../../.github/workflows/gather-offline.yml) runs this command with Node 22.22.2 and isolated dependencies on relevant pull requests and master pushes, with read-only repository permissions and no deployment steps. The historical Travis job is unchanged.

Correction coverage uses distinct values for every sea wave field, nonfinite values in later days, mismatched item counts and raw/once-percent-encoded dummy keys. Partial pages fail before organization, so responses over the 999-item capacity require a separate pagination implementation. Key strings decode URI escapes exactly once and re-encode as a query component; raw plus is preserved, malformed escapes fail, literal percent must be supplied as `%25`.

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
Git exclusion, existing-file preservation, missing sources and symlink handling.
They also check that the existing AWS-file setup is preserved. No private
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
