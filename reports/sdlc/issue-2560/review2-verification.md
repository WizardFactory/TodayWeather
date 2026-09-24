# Second review correction: verification and handoff

Base: b13dc38adece3d301765b03afea4a5feb9d02d8b. Final file-set identity: review2-candidate.json. Implements review5303256769 and the scheduler/humidity recommendations in comment5812616522. This continues the original issue-2560 counters and the user's correction/PR publication authorization; no merge, deployment or live recovery claim.

## Changes and acceptance

- A: one side-effect-free weather mapping accepts/converts both shower labels with existing rain-compatible pty1/icons, retaining provider text. Real parser, both mid schemas/storage projections and response conversion are covered. The duplicate global temperature list is removed.
- B: the41-slot hourly contract stays intact. Separate validated raw short data supplies D+3 and other available targets through each publication's KST date+4. DB2 retains row publication; DB1's optional current-batch dailySource replaces wholly on every successful collection/save, never borrowing partially merged hourly values. Existing DB1 data without this snapshot remains unavailable until normal collection. Invalid/expired/partial latest slots cannot revive older values; raw rain/snow sums are omitted. Internal gaps from today through the last available future target degrade health; unsupported trailing horizons remain listed separately. Diagnostics are sanitized and limited to one per minute per process.
- C: retired midrss is removed from startup/minute2 queues; active short RSS and legacy explicitly unavailable manual behavior remain. No provider/scheduler work was started locally.
- D: missing humidity no longer drops otherwise complete short/RSS daily weather; explicit provider min/max remain required, without invented extrema. Shared JS client parsing was executed against additive dailyStatus and shower/date fields. Native widget readers were inspected; no native build/runtime claim.

## Actual execution

Nodev22.22.2. External dependencies remain isolated in /tmp/issue-2560-offline/node_modules: async2.6.4, xml2js0.4.23, Mocha2.5.3, Express4.13.4, sprintf0.1.5, Mongoose5.1.2. Existing issue-captured land fixture reused; all new data synthetic. Fixed KST clock. HTTP/DB/timers/config intercepted before loading real modules. No app.js execution, real service key, provider request, production DB or /gather action.

| Command | Observed result |
| --- | --- |
| `NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/daily-review.test.js` before implementation | Six expected shower/health failures. A seventh scheduler setup error was separately corrected by stubbing immediate request collaborators and queue length; not treated as a product defect. Source-snapshot tests subsequently failed before their implementation. |
| Same command, final candidate | 11/11 pass: shower parser/storage/map, invalid label rejection, internal-gap/trailing policy, scheduler, per-slot publication/partial precedence, actual Mongoose DB1 batch replacement, KST year/midnight, actual shared JS client parser. |
| `NODE_PATH=/tmp/issue-2560-offline/node_modules npm --prefix server run test:offline` | 223 checks (103+22+11+44+43) plus gather smoke passed. |
| `TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/daily-response-smoke.js` | 68/68 actual v000903 scenarios passed, DB1/2 and C/F. Includes missing humidity, stored/expired/partial/absent D+3, DB1 without snapshot, both showers, history and untouched hourly bounds. |
| `TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules TW_SMOKE_OUTPUT_DIR=/tmp/review2-rss-final node server/test/offline/rss-response-smoke.js` | All36 existing RSS response scenarios passed. |
| `NODE_PATH=/tmp/issue-2560-offline/node_modules node /tmp/review2-before-probe.js` | Final11 assertions replayed against b13dc38 production sources in memory:10 expected failures and1 client compatibility pass. This corroborating replay occurred after implementation and is not presented as the initial Red run. |
| `node --check server/controllers/controllerTown.js`, `node --check server/lib/midForecastPolicy.js`; scoped `git diff --check` | Passed. |

Exact result tails/scenario outcomes and raw-log hashes: review2-executions.json. Large raw logs remain local instead of adding duplicate logs to this PR. Initial smoke expected numeric sky while the public presentation uses icon strings; corrected that test expectation. Gather smoke explicitly stubs the newly imported pure policy module. These harness adjustments are not hidden product failures.

Independent verification is in review2-independent.md: separate context, actual re-executions and additional mixed-publication/partial-slot/diagnostic probes. It is not cross-provider PR approval. New source hashes are recorded for comparison with the eventual commit.

## Architecture and operations

Updated the canonical mobile/collection documents and data contract. Installed Archify2.17 regenerated the daily validity HTML: all9 artifact checks passed, zero composition errors/warnings. Browser check passed light/dark at1440×900,1600×1000,1920×1080,2048×1320; the main agent opened the final2048×1320 dark capture and confirmed readable labels, cards and connectors without clipping. Retained generated screenshot receipt and review2-design.json identify the artifact. No hand-edited HTML.

The contract's operator checklist now includes the first normal DB1 short collection producing dailySource. No backfill, destructive migration or rollback cleanup is needed. Keep current/short/past/native behavior and origin/CDN verification as operator checks after approved deployment.

The reviewer-requested historical PR bulk reduction remains deferred: previous committed receipts reference exact report/log/generated-artifact hashes, and repository instructions require architecture artifacts. This correction keeps new execution evidence compact without deleting traceable prior evidence. Native binaries/all shipped clients remain unverified. External reviewer re-examination is still needed; the prior comment is not approval of this changed candidate.

Local acceptance is complete once independent verification validates the same source. Next authorized handoff: commit/push to the existing PR, verify remote head/CI and record exact commit mapping in its description. Leave the PR open and auto-merge disabled; no merge or deployment.
