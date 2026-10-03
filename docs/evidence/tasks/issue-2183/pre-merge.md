# Administrative-area fallback: local pre-merge verification

Date: 2026-10-04 (KST). Integrated base: `01fc19ef18ce9600b297009c66f159e5d169f1f1` (`origin/master`). Initial checks used `e0b126c8`; relevant checks were repeated after integration.
Scope: [issue #2183](https://github.com/WizardFactory/TodayWeather/issues/2183).
This record covers repository behavior and local checks, not deployment or live metadata freshness.

## Change and review

The exact address code still has priority. `LIFE_INDEX_NOT_FOUND` is an optional
no-data result, so the weather controller tries each remaining candidate from
its existing three-row nearest query, excluding the failed exact code. A DB
error stops further life-index reads. MFDS enrichment and weather continuation
remain independent. Successful fallback updates the request's `areaNo` and emits
a structured outcome with the session ID.

The pre-change regression read `4119700000`, then `4119900000`, and never reached
available `4119086000` data. The repaired path reaches the final candidate,
retains valid zero UV and copies it to today's current weather. These are
synthetic records, not confirmation that the 2018 issue's aliases are current.

The newer master added pollen summaries, tests and mobile popup documentation. Rebase conflicts were resolved by retaining both regression entries and merging diagram semantics; generated HTML was regenerated. Its final return message moved from y=437 to y=425 within the compacted readable timeline; all four desktop browser checks passed after the adjustment. A dedicated regression verifies that nearby pollen retains zero species grades and the maximum summary in daily and current weather.

Self-review checked callback termination, no-data versus store-error handling,
exact-code precedence, request-coordinate precedence, longitude/latitude order,
query bounds, zero values and optional enrichment continuation. No blocking
finding remained. No independent or human PR approval is claimed.

## Verification

Tests used isolated dependencies outside the repository; no application startup,
production Mongo connection, collection endpoint or live provider call occurred.
Loopback HTTP tests required ordinary execution outside the filesystem sandbox.

| Check | Environment | Result |
| --- | --- | --- |
| `npm --prefix server run test:offline` | Node 24.21.0; `async` 2.6.4, existing isolated test dependencies | Passed all commands selected by the offline runner |
| `node server/test/offline/life-index-area.test.js` | Node 16.20.2 | 13 passed, 0 failed |
| `node server/test/offline/life-index-2650.test.js` | Node 16.20.2 and Node 24.21.0 | 10 passed, 0 failed on Node 16; included in the passing Node 24 offline runner |
| `node server/test/offline/pollen-summary.test.js` | Node 16.20.2 | 4 passed, 0 failed |
| `TZ=UTC node server/test/offline/pollen-route-smoke.js` | Node 16.20.2 | Spring, autumn, zero and missing pollen passed |
| `node server/test/offline/riseset-uv.test.js` | Node 16.20.2 | 16 passed, 0 failed |
| `TZ=UTC node server/test/offline/riseset-uv-smoke.js` | Node 16.20.2 | 6 scenarios passed: DB 1.0/2.0, stores present/empty/failing |
| `python3 scripts/verification/test_artifact_policy.py` | Python 3 | 22 passed |
| `python3 scripts/verification/smoke_artifact_hooks.py` | Isolated temporary repositories | All functional scenarios passed |
| `node --check` on both changed controllers; `git diff --check` | Local working tree | Passed |

The first broad run used an older temporary `async` 2.5.0 and failed four existing
gather-quota tests. The gather CI specifies 2.6.4; rerunning with that version
passed. No dependency or gather-production change was made. Extra Node 16 pollen
checks initially failed three tests because their JSON-fixture copies used
`structuredClone`, unavailable on Node 16. Those copies now use JSON round trips;
fixtures contain only JSON values. Assertions and provider code are unchanged.

The [RSS workflow](../../../../.github/workflows/rss-offline.yml) now explicitly
runs the area-fallback and pollen tests on Node 16.20.2 and 22.22.2, in addition
to their inclusion in the broader offline runner.

## Diagram verification

[Sequence source](../../../architecture/diagrams/mobile-weather-request.json)
and [delivered HTML](../../../architecture/diagrams/mobile-weather-request.html)
were regenerated with installed Archify 2.17. The generated viewer also changed.
Two UV/pollen cards were consolidated and their JSON viewBox height compacted after browser inspection found card overflow on the small desktop view. Topology and historical routing claims
were preserved.

- Deterministic delivery: all 9 showcase checks passed; 0 errors, 0 warnings.
- Browser: containment and viewer checks passed at 1440×900, 1600×1000,
  1920×1080 and 2048×1320; light/dark screenshots were captured.
- Perceptual review: inspected light 1440×900 and dark 2048×1320 captures;
  diagram and cards fit without clipping or ambiguous crossings.
- Source SHA-256: `be548758394e01e09b985b02e25ebd864a023393ea6d10818a0f74b4bb834dd0`.
- HTML SHA-256: `1b85360b47919d9ceb8419b3a962241ed59dc57736a5d99059620bdfd5615461`.

Generated run logs and screenshots remain local-only. The staged snapshot and
actual outgoing commits must pass the artifact policy before publication.
Remote CI, PR mergeability and review state are reported on the PR after push.

## Assumptions and remaining limits

The existing `areaNoList` metadata, `$maxDistance: 0.3` and limit of three rows
are retained. Stale codes can crowd the bounded nearest list, so indices can
still remain absent. This does not migrate nationwide metadata or introduce
read-time life-index expiry. The historical aliases are not hard-coded.
No production DB update, release, deployment or merge is included.

## SDLC reconciliation and real local smoke

The shared SDLC skill became available during pre-merge on 2026-10-04. The established intent/spec/plan are now recorded in their canonical directories; no earlier stage execution or review is invented. The parent01fc19ef source was loaded into an isolated regression harness to reconstruct the failure (2 passed,11 intended assertion failures); final sources passed13/13 on Node16 and24.

`life-index-area-mongo-smoke.js` then passed3 scenarios with an actual local Mongo7.0.14, mongoose5.13.23 and loopback HTTP: exact-code precedence; missing exact/first-nearest codes reaching4119086000 with zero UV and pollen summary2; and missing all indices retaining the weather response. Only the geographic and area lookup indexes were created; the historical empty-string town index is unsupported by Mongo7. Weather and MFDS input are synthetic. All local HTTP/Mongo processes closed in finally. This does not prove the historical mongoose5.1 driver works with Mongo7 or establish current production metadata freshness.
