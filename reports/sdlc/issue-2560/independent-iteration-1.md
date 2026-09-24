# Independent verification: issue 2560

Historical iteration 1: CHANGES_REQUIRED. Later closure is recorded in independent-verification.md.

## Scope and identity

Iteration 1, executed 2026-09-24 at approximately 08:45–08:50 UTC. Verdict: **CHANGES_REQUIRED**. This is an independent, same-provider local verification context, not cross-provider PR review. Base: `01eb787b10cc2694ea52642b8b24ad8c5426503e`; candidate: uncommitted worktree diff plus new policy/tests. No production host, application startup, actual HTTP, DB connection, collector timer, credentials, remote write or commit was used.

Read repository instructions, the shared SDLC policy and installed verification contract, architecture index/collection path, and this task's intent/spec/plan/investigation. Inspected parser dispatch, both persistence paths/schema/projection, service merge/formatter/date logic, v000903 middleware ordering and RSS retirement.

Candidate SHA-256 at verification:

| File | SHA-256 |
| --- | --- |
| `server/lib/midForecastPolicy.js` | `23a34a792ea3bef32b9597e73ff92ccc5016d3f403a619d2dedbc86a0129d50a` |
| `server/controllers/controllerTown.js` | `84d62c8330df80ed970550c652d12ee6f8c11b898e759e0506e64d4986f6c2a9` |
| `server/lib/collectTownForecast.js` | `dde9f078fc34bc01fc2594048ddaecb705e4e208c25ec2c043ffdfeda8ccd0a1` |
| `server/controllers/kma/kma.town.mid.controller.js` | `176ac3249916445f350d1f55e96320f381eca914b50c9762b09b64c2f4899c68` |
| `server/lib/midRssKmaRequester.js` | `56f8fbad2030fb9112470a303f9507cd4762f9447286fcd3a4efe69d9e6bf011` |

## Executed checks

Runtime: Node `v22.22.2`; isolated dependencies resolved using `NODE_PATH=/tmp/issue-2560-offline/node_modules`: Mongoose `5.1.2`, async `2.6.4`, sprintf `0.1.5`, xml2js `0.4.23`, Mocha `2.5.3`.

| Command/scenario | Actual result |
| --- | --- |
| `NODE_PATH=/tmp/issue-2560-offline/node_modules node --test server/test/offline/daily-forecast.test.js server/test/offline/rss-wind.test.js` | Exit 0, 60 tests passed (17 daily, 43 existing RSS/wind regressions). |
| `NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/run.js` | Exit 0, 103 Mocha checks passed plus synthetic gather/storage smoke. |
| `NODE_PATH=/tmp/issue-2560-offline/node_modules node --test /tmp/issue-2560-independent-checks.js` | Exit 1, IV-1 and IV-2 failed as described below; IV-3 and IV-4 passed. |
| IV-3: actual `getMid`, no textual forecast in stub DB, fresh complete day-4 land/temp | One completion callback; `20260928` available. Missing text does not block usable primary data. |
| IV-4: actual `getMid -> getMidRss -> convertMidKorStrToSkyInfo -> mergeMidWithShort`, both primary datasets absent | All callbacks complete; valid today's short output remains, daily health false. |

An initial broad `node --test server/test/offline/*.test.js` invocation exited 1 because `gather-code-drift.test.js` uses Mocha's `describe`; its other 60 tests passed. This was a verifier command-selection error, not a product failure. The correct separate commands above subsequently passed.

The checked suite exercises captured day 4–10 values, legacy day 3, malformed envelopes, absent measurements, both real Mongoose schema casts with persistence stubbed, Manager handoff, both service projections, 06/18 KST identity, year/month boundaries, target-date joining, publication age, future/identity mismatch, seven-day history, honest day-3 gap, stale land/current temp/obsolete RSS, retired RSS on empty/populated lists, HTTP 401/error redaction and HTML/malformed XML rejection. The parser success and DB round-trip assertions are separate executed checks; no live provider contract is inferred. RSS publication precedence is uniformly disabled rather than replaced with an unverified URL.

## Must Fix findings

### IV-1 — Entirely unrecognized land weather is emitted as valid collection data

**Severity:** MEDIUM (requirement violation, Must Fix). **Category:** validation. **Location:** `server/lib/midForecastPolicy.js:21`, `parse` usable counter. **Confidence:** high. **Disposition:** open.

`weather()` checks only that text is nonempty. With a synthetic success envelope containing only `{regId:['11B00000'], wf4Am:['not weather']}` and options `{date:'20260924',time:'0600'}`, real `organizeLandData` emits `recvData` carrying this unrecognized string. No `recvFail` occurs. The consumer later rejects the same value, so an entirely unusable publication can be persisted as a successful collection and block retries until the next publication.

Requirement A says invalid data must fail in a controlled way and entirely empty/invalid forecasts must not emit success. The spec describes usable weather. Count recognized supported weather toward usability (preserving legitimate partial horizons) and add an unknown-only regression; an unrecognized-only response must fail without exposing provider text or keys.

Reproduction uses the real collector via the existing offline harness:

```js
const c = h.prepare(h.collector());
c.on('recvData', () => events.push('recvData'));
c.on('recvFail', () => events.push('recvFail'));
c.organizeLandData(0, h.response([
  {regId:['11B00000'], wf4Am:['not weather']}
]), {date:'20260924', time:'0600'});
// Expected ['recvFail']; observed ['recvData'].
```

### IV-2 — Partial invalid short weather overwrites valid mid weather and fabricates zero quantities

**Severity:** HIGH. **Category:** service merge/data validity. **Location:** `server/controllers/controllerTown.js:2889` (`mergeMidWithShort`, `_getDaySummaryListByShort`, `_mergeList`). **Confidence:** high. **Disposition:** open.

The added summary filter checks only temperature completeness and aggregate sky. `_mergeList` then copies every summary property. Start with a valid mid day `20260928`, `taMin:14`, `taMax:24`, `wfAm/wfPm:'맑음'`, sky/AM/PM sky `1` and pty/AM/PM pty `0`. Supply two synthetic short slots for that date at `0900` and `1500`, each with valid `tmn:10`, `tmx:24`, `t3h:20`, `reh:50`, `sky:1`, but `pty/pop/r06/s06/wsd/lgt:-1`. Run real `mergeMidWithShort`.

Observed daily row has `wfAm/wfPm:'구름적고 '`, `pty/ptyAm/ptyPm:-1` and fabricated `r06:0`, `s06:0`, `lgtAm:0`, `lgtPm:0`. The earlier mid formatter cannot protect this because it executes before the short overlay. The result retains a daily record whose valid weather has been replaced by an unrecognized phrase and whose missing quantities became zero.

Requirements A/B prohibit missing fields becoming default weather/zero precipitation, and the task spec explicitly says invalid/sentinel short fields cannot erase a valid mid row. Validate source fields before aggregation or overlay, with explicit missing-data handling; do not derive validity solely from aggregated values. Verify both overlap and short-only cases, including otherwise valid sky/temperature with missing precipitation/lightning. IV-2 currently fails on the first corrupted weather assertion; direct inspection also established the fabricated zero quantities.

## Limits and next gate

The successful checks do not establish live recovery, nationwide coverage, provider schema guarantees, production credentials, actual Mongo persistence, native builds, or deployed revision. Main owns the actual route smoke, final documentation/diagram verification and deployment/rollback checklist; they were still in progress during iteration 1. The candidate needs both Must Fix findings resolved, matching regressions and smoke rerun, followed by renewed independent verification before PASS.

