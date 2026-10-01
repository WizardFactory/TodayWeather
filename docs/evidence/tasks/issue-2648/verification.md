# Exact-hour station fallback verification

Date: 2026-09-30. Builder: main Codex context. Base: `6ec6c68c` after the requested `git pull origin master` fast-forward; local source/test candidate: `0a66d40da1a64dd6e1dc274099abad7ada4bef8a65ce03a4db93ae373358d0b7`. No commit or deployment is implied. The file manifest and raw runs remain local execution output; this record preserves the findings supporting the maintained response contract.

The chosen approach reuses the existing opt-in ASOS historical recovery/cache. Request-time provider access was rejected because its latency, entitlement and quota become API dependencies. A new same-day API Hub provider and primary grid quota redesign require separate work. Legacy station fallback uses exact KST wall-clock identity and a verified numeric whitelist, preserving valid grid fields. Per-field temperature provenance avoids station/grid comparisons and stale hourly provenance after live replacements.

## Executed checks

Environment: Node 22.22.2; UTC for route/collector smoke. Already provisioned temporary dependencies were selected through NODE_PATH; no package or credential changes. Synthetic fixture data only.

| Check | Result |
| --- | --- |
| `node server/test/offline/historical-fallback.test.js` | 9 groups pass; original -50/+73 defect reproduced before implementation; final fallback wait probe 250–251 ms and late callback ignored |
| `node server/test/offline/history-read-cache.test.js` | 5 groups pass: coalescence, late warming, negative cache, timeout, capacity |
| `history-observations.test.js`, `history-recovery.test.js` | 19 + 7 groups pass |
| `test.minute.merge.js` | 8 groups pass |
| `daily-forecast.test.js`, `daily-review.test.js` | 22 + 11 pass |
| `TZ=UTC node server/test/offline/rss-response-smoke.js` | 36 actual middleware/fixture scenarios pass |
| `TZ=UTC node server/test/offline/history-integration-smoke.js` | Temporary MongoDB 7.0.14 with driver 3.7.4 and loopback HTTP: 175 recovered records, five fixture provider requests, 16 actual route/client scenarios across DB 1.0/2.0 × C/F × four coverage states; no provider requests during responses |
| Intended content artifact policy (temporary index; actual index unchanged) | Passed; no generated report was staged |
| Artifact-policy regression | 19 tests pass |
| Archify deterministic delivery | 9/9 showcase checks, zero errors/warnings |
| Archify browser evidence | Chromium 1243; light/dark at 1440×900, 1600×1000, 1920×1080, 2048×1320; all contained, zero diagnostics |
| Perceptual diagram review | Both largest-viewport screenshots inspected; readable labels/cards and clear arrows; passed, zero correction rounds |

Diagram source SHA-256 `a2f673ebf84c7738345338bd5658f63c5ebfd62cf094b1ec093737912141ff6d`; delivered HTML SHA-256 `6c24bc97ecbb61420a80ff671938857ed03fc234f4b2688c88f30351d1e1c145` (802664 bytes). Generated screenshots/receipts remain ignored local runs. See [independent verification](independent-verification.md) for separately executed checks.

## Limitations and failed environment attempts

The 250 ms value covers fallback waiting after town lookup, not total API latency; event-loop scheduling, DB connection/server selection and later station-minute enrichment remain outside it. maxTimeMS limits server execution, not transport or cancellation. Caches are per process and may expose data up to their TTL; no production percentile, throughput or geographic-equivalence benchmark was run.

Restricted local process/listen permissions initially blocked test subprocesses and the Mongo smoke; authorized isolated runs subsequently passed. A Mongo driver 6.21.0 attempt returned HISTORY_LEASE_WRITE; the provisioned project-compatible 3.7.4 run passed. An earlier full `offline/run.js` stopped at gateway-route due to absent `cors`. With an already provisioned dependency set including cors, the next run passed through the relevant tests and gateway checks, then stopped at push-store because `sql.js` was absent. Neither attempt is a whole-suite pass; unrelated push checks remain unexecuted. Node 16/legacy production runtime and native clients were not executed.

GitHub issue comment creation returned HTTP 403 (integration access), and the existing gh token was invalid. An updated comment is retained locally; no publication is claimed. Production ASOS availability, deployment activation, primary provider quota recurrence and live backfill remain unverified and outside this local change.

## Pre-merge continuation — 2026-09-30

AK expanded authority to commit/push/PR/CI and pre-merge, excluding actual merge. The separately configured GitHub MCP authenticates as ak-ongyeol; [issue publication succeeded](https://github.com/WizardFactory/TodayWeather/issues/2648#issuecomment-5916562906). Earlier Apps/gh failures remain historical observations, not a claim that all GitHub access is unavailable. With already provisioned sql.js included, `TZ=UTC NODE_PATH=/tmp/tw-2590-srv/node_modules:/tmp/issue-2560-offline/node_modules:/tmp/tw-2626-final-lock/node_modules node server/test/offline/run.js` passed to completion. No dependency installation or product-source change was needed.

Independent different-provider PR review was launched through Paseo with Anthropic Claude Opus5.5, requested medium/auto. It returned the account weekly limit before reviewing (reset October3,16:00Europe/Berlin); no eligible PR review PASS or merge-ready claim is made. Existing local independent verification remains a distinct result. Production and fullissue quota work remain excluded.

## Review 5370162301 correction — 2026-09-30

The review exposed a client compatibility gap: the unchanged app comparison function ignores `comparisonAvailable`. Incomparable yesterday projections now omit `t1h`, while cached observations and their other fields remain intact. Exact-slot selection also skips invalid duplicate temperatures, including equivalent `2400`/next-day `0000` rows.

The new regression failed on the previous implementation before the fix, then all 11 historical-fallback groups passed. Tests execute the actual legacy client function with isolated translation/unit dependencies: mixed sources and invalid current temperatures produce no comparison in C/F, while valid zero/negative grid pairs still compare. The temporary Mongo/loopback smoke passed all 16 DB-version/unit/coverage scenarios, including the actual legacy comparison on serialized responses; 175 records and five fixture provider calls remain unchanged. The full offline suite also passed to completion with the provisioned dependency set above.

The updated diagram passed 9/9 showcase checks, browser checks at four desktop sizes in both themes, and perceptual inspection of both 2048×1320 screenshots. Current HTML SHA-256: `006b5b38ba622a934e75444ea79ea3921e89ce9df6c4e6da49c986ab9bf714c1`. Raw correction runs stay in ignored local reports. See [correction independent verification](review-correction-verification.md). Reviewer resolution and eligible different-provider review remain required before readiness.

## Grok review follow-up and authorized merge — 2026-10-01

AK confirmed review through Grok and explicitly authorized merge. PR comment5921592245 identified a further live-temperature regression. The fixed policy retains live-current versus same-town grid-yesterday comparison only when a valid live minute key belongs to the current observation hour and yesterday is exactly24hours earlier. Live/live pairs require the same station and validated hourly identities24hours apart. ASOS/grid, station/network mismatch, wrong-hour and invalid temperatures still omit projected yesterday temperature. Actual station middleware followed by each yesterday selector is exercised; serialized DB1.0/2.0 C/F routes retain +2C/+3F for the accepted21C/19C pair. This preserves the established display and does not prove spatial equivalence.

Late DB success after HISTORY_READ_TIMEOUT now warms only the identical retained cache entry once. It cannot replace a newer entry or re-complete detached callers. The old failure was reproduced before the fix. The legacy BSON convention remains UTC wall-clock storage: UTC ingestion is pinned by a subprocess regression; historical data written with other local timezones has not been repaired.

Executed: focused13 and cache7 groups, complete offline suite, distinct temporary Mongo/loopback smoke with175records5fixturecalls and20response/client scenarios (16historical plus4live/grid). Provider traffic is synthetic. The updated diagram passed deterministic9/9 and bounded desktop browser checks; visual inspection is recorded separately in local evidence. Latest master0e15411e adds disjoint web-release files; guarded deployment is workflow_dispatch-only, no GitHub backend deploy step is invoked by merge. Historical Travis deployment activity remains unverified.

The user merge instruction accepts their Grok review; automatic model/effort/mode metadata was not independently observed and is not relabeled as a fully validated automatic reviewer gate. No release/deploy/backfill action is authorized or performed.
