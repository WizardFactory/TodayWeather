# Mongoose station query compatibility verification

Date: 2026-10-03 UTC. Base: `43ed9dd36cdc9a7500ffdd4b58c859cdea7e78c0`.
Source: [deployment blocker](https://github.com/WizardFactory/TodayWeather/issues/2648#issuecomment-5963300354).
Scope: [intent](../../../../intent/issue-2648-mongoose.md), [spec](../../../../specs/issue-2648-mongoose.md), [plan](../../../../plans/issue-2648-mongoose.md).

Before product edits, the real pinned mongoose 5.1.2 station query failed with
`TypeError: KmaStnInfo.find(...).maxTimeMS is not a function` (exit 1).
After replacing the three Mongoose chains with `setOptions({maxTimeMS: 2000})`,
the same regression passed. Native MongoDB cursor `maxTimeMS` was preserved.

The following commands passed independently on Node 16.20.2 and 22.22.2 with
`TZ=UTC` and isolated dependencies including mongoose 5.1.2:

- `node server/test/offline/kma-query-compat.test.js`: real schema and Query
  construction, filters/projections/limit/sort/lean and 2000 ms option; empty/error
  station reads, enabled/disabled/error ASOS metadata, and native history cursor API.
- `node server/test/offline/kma-query-route-smoke.js`: four real loopback HTTP
  address requests across DB formats 1.0/2.0 and success/storage failure. Successful
  responses retained historical `22.7` and `KMA_STATION_HOURLY`, station `108`,
  key `202609230900` provenance. Failure returned no invented station provenance.
- `node server/test/offline/history-observations.test.js`: 19 checks.
- `node server/test/offline/history-recovery.test.js`: 7 checks.
- `node server/test/offline/runtime-node16.test.js`.
- `node server/test/offline/rss-wind.test.js`.
- `node server/test/offline/weather-desc.test.js`.
- `node server/test/offline/rss-response-smoke.js`: 36 response scenarios.
- `node server/test/offline/weather-desc-response-smoke.js`.

Query construction/chaining is the actual pinned implementation. Query `exec`
is intercepted to return fixture rows; no Mongo server or production connection
is made. The HTTP listener/router and historical station controller run locally;
live current-weather collaborators and unrelated storage remain fixture-based.
This establishes runtime API compatibility and route composition, not Mongo
server timeout enforcement, deployed host behavior or recovered production gaps.
No deployment, production configuration/key changes, provider calls or backfill
were performed. Original #2648 quota and historical recovery work stays open.

CI adds both new checks to the existing RSS Node 16/22 matrix. The maintainer
[commands and limits](../../../../server/test/offline/README.md#station-query-compatibility-2648)
and [operating note](../../../operations/kma-station-observations.md#legacy-mongoose-query-compatibility)
are updated. No HTTP/schema/timezone/source-policy/scheduling contract changed;
architecture diagrams and feature/PDF manuals are not applicable.

Local artifact hooks are available but not installed. Staged and outgoing commit
policy checks are run explicitly; remote CI remains independently observable.
Post-commit review, CI and readiness receipts belong in the scoped PR, rather
than an evidence-only commit that changes the reviewed candidate.
