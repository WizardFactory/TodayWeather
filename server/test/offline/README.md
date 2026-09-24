# Isolated weather checks

## Gather reconciliation tests

All provider fixtures are synthetic. These tests load real exported functions with explicit VM dependency injection before evaluation. HTTP, DNS initialization, logging, model methods and timers cannot access production; undeclared dependencies/timers fail immediately. No `app.js`, configuration file, `/gather/*` route or Mongo initialization is loaded.

Use an isolated harness instead of installing the whole legacy application:

```sh
npm install --prefix /tmp/issue-2555-harness --ignore-scripts --no-audit --no-fund --package-lock=false mocha@2.5.3 xml2js@0.4.23 async@2.6.4
NODE_PATH=/tmp/issue-2555-harness/node_modules npm --prefix server run test:offline
```

Commands run from the repository root; dependency installation needs package-registry access, but test execution needs no network. Tested with Node v22.22.2/npm 10.9.7. Mocha 2.5.3 is within the repository's legacy range; no application dependency tree changes are made.

The separate smoke integrates real XML parsing, requestData/events and the short storage controller's save/read functions through synthetic HTTP and in-memory model adapters. It verifies timestamps, coordinates, exact values and no write on failure. It is not a live provider/DB/mobile test.

The legacy 24h consumer characterization deliberately exposes its adjacent-record quantity split. Passing means the existing assumption is documented; it does not validate that split for hourly PCP/SNO. See [period limitations and full disposition](../../../docs/architecture/gather-source-reconciliation.md).

`test:offline` explicitly runs only the regression file, then the functional smoke, and propagates failures. The default `npm test` remains the legacy suite. The dedicated [GitHub Actions workflow](../../../.github/workflows/gather-offline.yml) runs this command with Node 22.22.2 and isolated dependencies on relevant pull requests and master pushes, with read-only repository permissions and no deployment steps. The historical Travis job is unchanged.

Correction coverage uses distinct values for every sea wave field, nonfinite values in later days, mismatched item counts and raw/once-percent-encoded dummy keys. Partial pages fail before organization, so responses over the 999-item capacity require a separate pagination implementation. Key strings decode URI escapes exactly once and re-encode as a query component; raw plus is preserved, malformed escapes fail, literal percent must be supplied as `%25`.

## Isolated RSS checks

Run from the repository root with Node 18+ (validated with Node 22.22.2):

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

[RSS offline checks](../../../.github/workflows/rss-offline.yml) runs on pushes and pull requests using Node 22 and `TZ=UTC`, matching the server timezone confirmed by the operator. It runs all 43 regression tests and all 36 response smoke cases (both DB formats, three synthetic grids, newer/equal/older publications and both unit systems). A failure in either command fails the job.

Smoke dependencies and output stay under the runner's temporary directory. This workflow is independent of the legacy Mocha/Travis suite and requires no production credentials, database, provider access or service startup. Hosted runner setup and npm installation require network access; the weather checks themselves use isolated dependencies.


## Daily forecasts (#2560)

`daily-forecast.test.js` runs the captured day-4–10 regression plus synthetic
parser/storage/service/freshness/RSS cases. The only captured input is
`fixtures/mid-land-captured.json`. `daily-harness.js` uses actual Mongoose schemas
with in-memory persistence adapters and a fixed clock; no Mongo connection.

Install an isolated test environment (no repository dependency changes):

```sh
npm install --prefix /tmp/issue-2560-offline --ignore-scripts --no-audit --no-fund async@2.6.4 xml2js@0.4.23 mocha@2.5.3 express@4.13.4 sprintf@0.1.5 mongoose@5.1.2
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
read as text only. Tests require Node >=18. Historical production Node builds
and real provider/deployment behavior remain operator checks.

See [daily contract and deployment checklist](../../../reports/sdlc/issue-2560/daily-forecast-contract.md).

`daily-review.test.js` adds shower mapping/storage, forecast-gap health, retired scheduler, raw short source publication bounds, DB1 complete snapshot replacement, KST year/midnight and shared JS consumer compatibility checks. Full-route smoke covers D+3 available, absent, partial, stale and DB1 legacy-without-snapshot, showers and optional RSS humidity. Raw additional daily fields do not expand the hourly template or invent daily precipitation totals. Native runtime tests remain operator-owned.

## Historical observations (#2564)

`history-observations.test.js` and `history-recovery.test.js` run in `test:offline`.
They cover strict KST identities, QC/missing-value validation, sparse history,
independent daily observations, partial-field preservation, explicit past gaps,
pagination, missing-only recovery and duplicate/lease behavior with synthetic data.
Run the observation suite under `TZ=UTC` and `TZ=America/Los_Angeles`.

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
