# Independent verification: hourly station fallback

Date: 2026-09-30. Verifier: non-builder Codex agent `qa_asos`. Endpoint: local implementation; no commit, deployment, production query or provider authentication validation.

Reviewed base: `6ec6c68ceb518e22382ba2c24428964d4d2e0e67`.
Reviewed final source/test candidate: `0a66d40da1a64dd6e1dc274099abad7ada4bef8a65ce03a4db93ae373358d0b7`.
All 16 file hashes in the builder's candidate manifest matched the independently read files. The manifest's file set also exactly matched tracked changes plus untracked files under `server/`, independently enumerated with Git. This identity covers code and tests, not subsequent documentation edits.

The earlier verified candidate was `1952144e63d39032f8d5692a08fbe01336255eb4a1b1455cf9968666b7aad683`. Its 14 file hashes, including every product source file and functional smoke dependency, remained unchanged. The final candidate adds explicit observation-helper dependencies to two existing isolated test loaders. The verifier inspected both diffs and executed both tests again; prior product/regression/smoke evidence remains applicable because those bytes did not change.

## Verdict

**PASS for the scoped local implementation.** No unresolved mandatory source finding remains. This is independent verification, not a published PR review or a readiness receipt for production deployment. The complete quota/coverage objectives of issue #2648 remain outside this change.

The change reuses stored observations, fills only invalid numerical fields at exact KST hourly slots, and preserves each contributed field's provenance. It avoids provider calls while composing responses. Shared process-local caches coalesce reads, limit entries and wait, and briefly retain failures. Yesterday selection uses the current observation's date/hour rather than the wall clock or the next available hour. Celsius eligibility survives requested unit conversion; missing or incompatible observations keep weather descriptions without a temperature comparison.

## Findings resolved during verification

| Severity | Category / location | Finding and evidence | Resolution |
| --- | --- | --- | --- |
| HIGH | Data / `controllerTown.js` station enrichment | A later live-station temperature replacement could leave historical temperature provenance attached to the new value, allowing a comparison against the wrong source. `_updateCurrentFromMinWeather` initially copied only legacy model fields. | The actual contributing replacement now records `KMA_STATION_LIVE` provenance and transfers it to the corresponding history row. Regression executes the station middleware and transfer helper. |
| MEDIUM | Contract / `controllerTown.js` live key | The first key formatter assumed an ISO string, but the legacy station controller supplies dotted KST timestamps. | Existing dotted timestamp conversion now creates the provenance key. Actual middleware fixture `2026.09.30.19:27` verifies `202609301927`. |
| MEDIUM | Latency / legacy read and read cache | The caller timeout did not cancel an underlying legacy database read, and immediate entry deletion allowed repeated failed reads. | Legacy station queries now use `maxTimeMS(2000)`; failures remain cached for 2.5 seconds. Documentation explicitly distinguishes the response wait from database cancellation and total API latency. |

The latency finding does not establish a universal database/client timeout: Mongo execution limits exclude queueing, connection establishment and driver buffering. Worker processes maintain separate caches. The 250 ms fallback budget begins after town lookup and depends on event-loop scheduling.

## Independently executed checks

Environment: Linux, Node `v22.22.2`, `TZ=UTC` for integrated checks. No production service startup or collection endpoint was used.

| Check | Command / result | Scope |
| --- | --- | --- |
| Fallback regression | `node server/test/offline/historical-fallback.test.js`: exit 0, 9 scenarios | Missing/nonfinite/sentinel temperatures; both yesterday middleware paths; legacy BSON Date matching and field preservation; provenance compatibility; midnight; live replacement; legitimate converted Fahrenheit sentinel-looking value; actual dotted station timestamp; one completion and no late response mutation. Observed fallback wait: 250 ms. |
| Cache regression | `node server/test/offline/history-read-cache.test.js`: exit 0, 5 checks | Single-flight callers, bounded wait, late warming, short failure reuse, read deadline and bounded entry admission. |
| Station compatibility | `node server/test/offline/test.minute.merge.js`: exit 0, 8 scenarios | Existing freshness and invalid-value rules, rainfall behavior and missing-hourly continuation. |
| Historical observation compatibility | `node server/test/offline/history-observations.test.js`: exit 0, 19 scenarios | Historical ranges/normalization, per-field recovery, daily repair, station mapping, scheduling and rain handling. |
| Recovery compatibility | `node server/test/offline/history-recovery.test.js`: exit 0, 7 scenarios | Missing-only recovery, idempotency, leases, source rejection, storage failure, pagination and deadlines. |
| Final candidate test-loader additions | `node server/test/offline/weather-desc.test.js`: exit 0, 5 tests; `node server/test/offline/air-summary.test.js`: exit 0, 7 tests | Existing description and air-summary expectations stay intact with explicit helper dependencies, including keeping non-comparison weather text. |
| Separate functional smoke | `node server/test/offline/history-integration-smoke.js`: exit 0 | Real isolated MongoDB plus loopback HTTP provider fixture: 175 stored records, 5 recovery HTTP requests, readback/idempotency/lease checks; 16 route/client scenarios across DB formats 1.0/2.0, C/F and complete/hourly-only/daily-only/no-data coverage; wrong-date rejection and bounded retries. Response reads do not fetch the fixture provider. |
| Additional independent probes | Inline Node assertions: exit 0, 5 probes | Year/month/midnight boundaries; yesterday selection does not mutate the original historical row; sequential legacy temperature and ASOS humidity contributions retain distinct field provenance without suppressing an otherwise compatible temperature comparison. |
| Candidate/format | SHA-256 comparison of manifest files; `git diff --check`: exit 0 | All candidate file hashes matched; no whitespace errors. |

Dependency-backed commands used `NODE_PATH=/tmp/tw-2585-mongo/node_modules:/tmp/issue-2560-offline/node_modules`. The first smoke attempt was blocked by sandbox `listen EPERM`; the permitted isolated rerun passed. One historical-observation run without that dependency path failed setup (`async` missing); its configured rerun passed. Neither setup failure was counted as a behavioral failure or a passing run.

## Documentation and limits

The maintained [mobile API contract](../../../architecture/mobile-api.md#exact-hour-fallback-and-response-latency-2648) describes exact-time merging, additive missing comparison objects, live-versus-hourly comparison suppression, cache limits and timeout scope. The [historical observation diagram](../../../architecture/diagrams/historical-observations.json) reflects field provenance and bounded cached reads. Browser/visual diagram results are builder evidence; this verifier independently inspected source contracts and executed functional checks, without claiming an independent visual browser run.

No authenticated live ASOS response, operating station cache, production latency percentile, mobile/native build, cloud route, deployment or cross-provider review was verified. The nearest configured station rule remains an approximation, not proof of terrain/coastal representativeness. No new same-day provider, spatial correction, interpolation or gather-quota redesign is included. Local Node 22 runs alone do not establish the declared Node 16 deployment runtime; runtime compatibility is a separate builder check.
