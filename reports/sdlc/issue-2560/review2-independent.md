# Independent verification: second PR review correction

**Verdict: PASS. No unresolved Must Fix finding.** Independently examined the uncommitted correction against `b13dc38adece3d301765b03afea4a5feb9d02d8b` and executed the checks below, completed 2026-09-24 at approximately 11:56 UTC. This is local verification in a separate same-provider context, not cross-provider PR approval or proof of operational recovery.

Read the latest review assessment and `review2-plan.md`. Scope covers shower handling, safely available D+3 daily forecasts, source publication preservation, health/diagnostics, optional humidity and retired scheduling. No production module startup, external provider/DB connection, live collection, remote mutation or source edit was performed by this verifier. `app.js` was inspected as text only.

## Source assessment

- Weather acceptance and conversion now use one mapping. Both shower labels preserve their wording and map to existing rain-compatible `pty=1`, avoiding a new client enum. All preexisting switch labels remain recognized; returned mapping objects do not share mutable state.
- The hourly 41-slot template is unchanged. Raw stored forecasts feed a separate request-local path only for daily dates beyond D+2. This avoids changing hourly pagination, precipitation redistribution or intermediate current/shortest transforms.
- DB2 preserves each document's own publication with its raw daily fields before the old public projection discards that metadata. Latest duplicate slots are selected before age/target validation; a newer incomplete slot cannot silently borrow an older value. A fresh outer publication does not revive an expired minimum from another row.
- DB1 writes an optional raw `dailySource` batch and replaces it wholesale on both initial and update saves. It does not copy fields retained by the legacy partial hourly merge. The real Mongoose-schema test demonstrates a partial replacement removes the prior minimum/sky and absent previous horizon from the daily snapshot while leaving legacy hourly history intact. Preexisting DB1 documents without that snapshot remain explicitly unavailable for the extension until recollection; no inferred publication/backfill is claimed.
- Extended rows retain their source's 0–24-hour age and KST publication-day +4 bound. They require valid weather and explicit extrema. Raw overlapping rain/snow quantities are excluded from the snapshot; no new daily sum is manufactured.
- Daily health now marks an internal missing day through the last available future target as degraded, while not requiring unsupported trailing horizons. Invalid rows are also marked unhealthy. The warning contains sanitized reason/date/publication values and is limited to one per minute per process.
- Humidity no longer gates otherwise complete short/RSS daily weather. Missing min/max still means unavailable; missing humidity is omitted rather than filled with a reading. Only short-summary behavior changed; historical summaries retain their existing path.
- Startup/minute-2 scheduling no longer enqueues retired mid RSS; short RSS remains scheduled. The redundant global temperature field array is removed while the shared policy remains the source for the three consumers.

## Executed checks

Node `v22.22.2`; `TZ=UTC`; isolated dependencies under `/tmp/issue-2560-offline/node_modules`: Mocha 2.5.3, xml2js 0.4.23, async 2.6.4, Mongoose 5.1.2, sprintf 0.1.5, Express 4.13.4. All newly constructed inputs are synthetic. Full-route execution uses real parser/controller/Express middleware code with config, model/provider and timer boundaries replaced before evaluation.

| Command | Actual result |
| --- | --- |
| `TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/run.js` | Exit 0: **222 regression checks** (103 Mocha +22 daily +10 latest-review +44 short-RSS daily +43 RSS/wind), plus gather functional smoke. |
| `TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/daily-response-smoke.js` | Exit 0: **68 complete response scenarios passed**, including D+3 available/stale/partial/absent, old DB1 without a snapshot, both shower labels, missing humidity, previous RSS regression cases, both DB versions and Celsius/Fahrenheit. |
| `TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules TW_SMOKE_OUTPUT_DIR=/tmp/review2-original-smoke node server/test/offline/rss-response-smoke.js` | Exit 0: **36 prior full-route RSS compatibility scenarios passed**. |
| `TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules node --test /tmp/review2-independent-probe.js` | Exit 0: **5 independently constructed focused probes passed**, detailed below. |
| `git diff --check` | Exit 0. |

Independent probes use the real DB2 `getShortFromDB` projection and actual daily merge, with only its model query stubbed:

1. An expired 06:00 minimum and fresh 15:00 maximum produce a fresh outer publication but **no D+3 daily row**. The minimum retains its expired own publication.
2. Two same-target/time entries, an older still-fresh complete minimum followed by a newer missing minimum, do **not** revive the older minimum. Latest partial remains unavailable through real projection and composition.
3. Valid independently published D+3 minimum/maximum with `reh:-1` produce a complete daily row. Humidity and precipitation aggregate are absent, source records are unchanged, and publication metadata is not copied into the public daily row.
4. Two degraded requests at the same clock emit one warning; a third after 60,001 ms emits the second. Synthetic secret-like publication text and request-region markers do not appear in the health warning.
5. Every legacy case label extracted from the HEAD converter remains accepted by the shared mapping. Mutating one returned conversion object does not affect another. Both added shower labels use `pty=1`.

The builder's separate executed tests also cover DB1 real schema save/update replacement, source-time month/year and midnight boundaries, health internal gaps versus trailing unknown days, and startup/minute-2 scheduling. These are meaningful functional checks, not source-string assertions substituted for behavior.

## Client compatibility and limits

Inspected `client/www/js/service.weatherutil.js` `_parseMidTownWeather`: it iterates `dailyData` and locates today by `fromToday`. Inspected `tw.ios/widget/TodayWeatherUtil.m`: it accesses `midData.dailyData` by key and searches calendar dates. Source evidence supports adding a legitimately available D+3 row and additive health metadata without changing a fixed index contract. The full-route tests exercise existing v000903 `tmn`/`tmx`, icon conversion, temperature units and absence of internal source metadata. No browser/mobile/native application was built or executed, and no claim is made about every shipped binary.

A DB1 legacy document without a raw snapshot, a stale/future row publication, missing explicit extrema, or unsupported raw accumulation remains unavailable intentionally. The checks do not establish production collection contents, credentials, provider vocabulary completeness, nationwide recovery or deployed-code parity. Main owns final documentation/Archify receipts, commit/push and remote CI/reviewer interaction; this report does not authorize merge or deployment.

## Tested candidate identity

| File | SHA-256 |
| --- | --- |
| `server/app.js` | `85041f44b13705dffc35e52966384b2a75db9c14bb2465d76e2b086bc7866836` |
| `server/controllers/controllerManager.js` | `a7b4817a81749ef7db9c162a25a938a2177af86c3894ee053d85125b7e8467ef` |
| `server/controllers/controllerTown.js` | `a66fd8902b1c39b50baee03d5804650b4008069cf4518a9275c052c11da55ccc` |
| `server/controllers/kma/kma.town.short.controller.js` | `95886528925f7087de10b53c46767c8d96ad658a2156041d886d1340a9471b2f` |
| `server/lib/midForecastPolicy.js` | `861bb60bbcc5044c4885e2889ba06fdf1d8e15711243f059cb71a15c9c61d5f5` |
| `server/models/modelShort.js` | `f5d9620f44898755f62a5828414edd4044ab80dba4bd4676f1218f68095850fd` |
| `server/test/offline/daily-review.test.js` | `4660cc777237b94ae2796997ec482ed0ece751f7f138843fb21b11c41750ec74` |
| `server/test/offline/daily-response-smoke.js` | `2808f3093aaf4c3a4e3241eeada8e38ce05133898f75f3b62acb6da37cda6145` |

## Final test-only refresh (2026-09-24 11:58 UTC)

**PASS retained; final source coverage confirmed.** After the earlier independently executed 222-check full suite, the author added a source-extracted shared-client parser test and tightened the scheduler test to distinguish actual minute-2 operation (`putAll=false`) from startup (`putAll=true`). Inspected these changes, then executed:

```sh
TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules node --test server/test/offline/daily-review.test.js
```

Exit 0, **11/11 passed**. This independently exercises the added client parser test and the strengthened scheduler branches. The parser function is extracted unchanged from `client/www/js/service.weatherutil.js` and evaluated in an isolated VM: additive health metadata leaves parsed output unchanged while D+3/shower fields survive. This is real shared-JavaScript function execution, not a browser or native build.

The independent execution record is therefore **earlier full 222 checks + final focused 11 checks (including one newly added check)**, rather than an independently rerun full 223-check suite. Main reports its final complete 223-check suite, 68-scenario daily smoke and 36-scenario original RSS smoke passed; that later full-suite execution is author evidence. The already independently executed 68/36 route runs remain applicable because application behavior did not change.

Recomputed all eight hashes in the candidate table using Python SHA-256: all match the table's final bytes. In particular the final `daily-review.test.js` hash is `4660cc777237b94ae2796997ec482ed0ece751f7f138843fb21b11c41750ec74`, and final `app.js` is `85041f44b13705dffc35e52966384b2a75db9c14bb2465d76e2b086bc7866836`. The table was captured after those concurrent test/blank-line edits; this focused run now explicitly closes their verification coverage. No production logic changed after the earlier full execution, so unaffected checks were not repeated.
