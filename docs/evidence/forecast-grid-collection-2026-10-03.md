# Forecast grid verification — 2026-10-03 UTC

Scope: [issue 2676](https://github.com/WizardFactory/TodayWeather/issues/2676), legacy server on base e0b126c8. Synthetic provider only; no deployment/provider-entitlement/production recovery claim.

The test-first Manager repeat assertion failed on baseline: expected2,033 collection calls, observed4,066. Full-grid regressions subsequently passed for short/ultra-short and DB1/DB2, including exact/new publication, recreation and one-grid repair. Coverage/lifecycle checks passed for required/conditional fields, signed/zero values, raw malformed/missing categories, read/write failure, overlap, deadlines, late callbacks and key rejection. Full offline suite completed with exit0; existing current/response/quota checks remain passing.

Real smoke: Node16.20.2, actual Mongoose5.1.2, Mongo4.4.29, synthetic loopback HTTP. Every combination uses2,033 grids, complete persisted-slot readback and same-publication coalescing. Repeated and recreated Manager polls sent0 HTTP. Deliberately missing REH in one grid alone repaired; final pending count0.

| Storage | Product | Slots/grid | Total HTTP attempts | Continuation attempts | Forced transient failures | Repeat HTTP | Repair HTTP |
|---|---|---:|---:|---:|---:|---:|---:|
| DB1 | Short | 86 | 4070 | 2035 | 1 | 0 | 2 |
| DB1 | Ultra-short | 6 | 2035 | 0 | 1 | 0 | 1 |
| DB2 | Short | 86 | 4070 | 2035 | 1 | 0 | 2 |
| DB2 | Ultra-short | 6 | 2035 | 0 | 1 | 0 | 1 |

Total includes initial pages, one grid retry and deliberate repair. These are measured synthetic calls, not daily production usage. Temporary model indexes are created before collection. Two earlier smoke attempts were stopped for unindexed/whole-object upsert lookup performance; neither is PASS. DB2 now queries the same identity via the existing mx/my/fcsDate index; the final run passed and cleaned its temporary services/data.

Reproduce using [offline commands](../../server/test/offline/README.md#forecast-grid-collection-2676). Additional checks: git diff --check; Archify finalize validate/deliver/check/browser-check and artifact-bound visual-check; builder inspected1440px light/dark captures. Operations/architecture/configuration/README documentation was checked. This is a bug fix without UI/new user capability, so no new PDF manual applies.

Official horizon/category reference: [data.go.kr 15084084](https://www.data.go.kr/data/15084084/openapi.do), guide 2609 downloaded 2026-10-03. Existing formats/keys/schedules/grid/server2 remain. DB1 historical arrays have no per-field publication provenance; newly admitted batches are fully validated before relabeling. Already issued Mongo operations may settle after expiry but are publication-fenced (see the review correction below); guards are process-local. AC4 production successive-publication/full-grid/public-output readback remains pending separate deployment authorization.

## Independent review corrections

Review of initial commit `ae296b16` independently reproduced 70 HTTP attempts for a deterministic invalid grid. Content validation now leaves that grid pending without transport retries. Added regressions cover the default retry budget, a write failure alongside a recoverable transport failure, and real DB1 writer preservation of conditional same-day extrema/WAV. DB2 coverage now uses an existing indexed forecast-time range alongside exact publication matching. Final commit, review and CI identity are retained in PR #2678; the initial review is not presented as PASS.

PR review `5402654383` on head `5a9c936a` reproduced out-of-horizon rows passing admission and a deadline-expired, already admitted older write replacing a completed newer publication. Out-of-horizon provider items are now dropped before writes and admitted batches must contain exactly the expected slots. DB2 controlled updates are fenced on `pubDate` with an absent-slot `$setOnInsert` fallback; DB1 controlled saves compare-and-set the read `pubDate` and refuse to downgrade. New regressions fail on the previous writers and pass now; the pinned Node 16.20.2/Mongoose 5.1.2 smoke additionally writes an older publication after completion and verifies unchanged coverage without duplicate DB2 slots. Legacy rows without provenance (DB1 merged arrays, DB2 defaulted `lgt`) remain trusted only for the publication current at deployment, because the issue excludes schema changes; this is documented in the operations policy.

Audit after `974281db` added regressions for a failed after-collection coverage read, Manager-level out-of-horizon filtering and the DB2 `fcsDate`/payload consistency check, made the coverage read wait configurable (`GATHER_FORECAST_READ_TIMEOUT_MS`) and emitted `readMs`/`read-failed` in coverage records. On 2026-10-04 AK chose one full ultra-short refresh per current publication (base+40min window, `GATHER_SHORTEST_REFRESH_AFTER_MS`) because the guide states ultra-short temperature/humidity/wind update every ten minutes. Production short row counts (1,052/1,016/835-980) exceed the computed horizon by exactly one 12-category slot, so a valid trailing row within one day after the final expected slot is kept instead of dropped; the exact slot is unverified without a real response.
